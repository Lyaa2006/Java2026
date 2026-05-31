package app.service;

import app.model.AssignmentStatus;
import app.model.Submission;
import app.model.User;
import app.util.FileUtils;
import java.io.File;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

public class SubmissionServiceImpl implements SubmissionService {
    private final DataStore dataStore;
    private final File submissionRoot = new File("data/submissions");
    private final File reviewRoot = new File("data/reviews");
    private static final String RICH_MAGIC = "RICH1\n";
    private static final long ONLINE_EDIT_LOCK_TIMEOUT_MILLIS = 10 * 60 * 1000L;

    public SubmissionServiceImpl(DataStore dataStore) {
        this.dataStore = dataStore;
        if (!submissionRoot.exists()) {
            submissionRoot.mkdirs();
        }
        if (!reviewRoot.exists()) {
            reviewRoot.mkdirs();
        }
    }

    @Override
    public Submission submit(User student, File file) throws Exception {
        if (file == null || !file.exists()) {
            throw new Exception("请选择有效文件");
        }
        String id = UUID.randomUUID().toString();
        String storedName = id + "_" + file.getName();
        File studentDir = new File(submissionRoot, student.getUsername());
        if (!studentDir.exists()) {
            studentDir.mkdirs();
        }
        File targetFile = new File(studentDir, storedName);
        FileUtils.copyFile(file, targetFile);
        Submission submission = new Submission(id, student.getUsername(), student.getDisplayName(), storedName, LocalDateTime.now());
        dataStore.getSubmissions().add(0, submission);
        dataStore.save();
        return submission;
    }

    @Override
    public List<Submission> listForStudent(String username) {
        List<Submission> result = new ArrayList<>();
        for (Submission submission : dataStore.getSubmissions()) {
            if (submission.getStudentUsername().equals(username)) {
                result.add(submission);
            }
        }
        return result;
    }

    @Override
    public List<Submission> listAll() {
        return new ArrayList<>(dataStore.getSubmissions());
    }

    @Override
    public void addReview(Submission submission, File reviewFile, String teacherNote) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (reviewFile == null || !reviewFile.exists()) {
            throw new Exception("请选择批改文件");
        }
        File studentDir = new File(reviewRoot, submission.getStudentUsername());
        if (!studentDir.exists()) {
            studentDir.mkdirs();
        }
        String storedName = submission.getId() + "_review_" + reviewFile.getName();
        File targetFile = new File(studentDir, storedName);
        FileUtils.copyFile(reviewFile, targetFile);
        submission.setReviewFileName(storedName);
        submission.setTeacherNote(teacherNote);
        submission.setStatus(AssignmentStatus.REVIEWED);
        dataStore.save();
    }

    @Override
    public boolean isTextSubmission(Submission submission) {
        if (submission == null || submission.getFileName() == null) {
            return false;
        }
        String name = submission.getFileName().toLowerCase();
        return name.endsWith(".txt") || name.endsWith(".java") || name.endsWith(".md") || name.endsWith(".csv");
    }

    @Override
    public String loadSubmissionText(Submission submission) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (!isTextSubmission(submission)) {
            throw new Exception("当前文件不支持在线查看");
        }
        File source = getSubmissionFile(submission);
        return FileUtils.readText(source);
    }

    @Override
    public String ensureOnlineEditableContent(Submission submission, String originalContent) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (!isTextSubmission(submission)) {
            throw new Exception("当前文件不支持在线编辑");
        }

        String existing = submission.getOnlineReviewContent();
        if (isRichContent(existing)) {
            return existing;
        }

        String teacherPlain = existing;
        String studentPlain = submission.getOnlineStudentFixContent();
        String rich = migrateLegacyToRich(originalContent == null ? "" : originalContent, teacherPlain, studentPlain);

        submission.setOnlineReviewContent(rich);
        if (studentPlain != null && !studentPlain.isBlank()) {
            submission.setOnlineStudentFixContent(null);
        }
        dataStore.save();
        return rich;
    }

    @Override
    public String exportOnlineEditablePlainText(Submission submission) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (!isTextSubmission(submission)) {
            throw new Exception("当前文件不支持在线导出");
        }
        String content = submission.getOnlineReviewContent();
        if (content == null || content.isBlank()) {
            content = submission.getOnlineStudentFixContent();
        }
        if (content == null || content.isBlank()) {
            return loadSubmissionText(submission);
        }
        return toPlainText(content);
    }

    @Override
    public String tryAcquireOnlineEditLock(Submission submission, String role, String username) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (role == null || role.isBlank() || username == null || username.isBlank()) {
            throw new Exception("锁定参数不完整");
        }
        synchronized (dataStore) {
            OnlineEditLock existing = dataStore.getOnlineEditLock(submission.getId());
            long now = System.currentTimeMillis();
            if (existing == null || isLockExpired(existing, now) || isSameOwner(existing, role, username)) {
                dataStore.putOnlineEditLock(submission.getId(), new OnlineEditLock(role, username, now));
                dataStore.save();
                return null;
            }
            return existing.getRole() + "（" + existing.getUsername() + "）";
        }
    }

    @Override
    public void releaseOnlineEditLock(Submission submission, String role, String username) {
        if (submission == null || role == null || username == null) {
            return;
        }
        synchronized (dataStore) {
            OnlineEditLock existing = dataStore.getOnlineEditLock(submission.getId());
            if (existing == null) {
                return;
            }
            if (isSameOwner(existing, role, username)) {
                dataStore.putOnlineEditLock(submission.getId(), null);
                dataStore.save();
            }
        }
    }

    @Override
    public void saveOnlineReview(Submission submission, String reviewedContent, String teacherNote) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (!isTextSubmission(submission)) {
            throw new Exception("当前文件不支持在线批改");
        }
        if (reviewedContent == null) {
            throw new Exception("批改内容不能为空");
        }
        submission.setOnlineReviewContent(reviewedContent);
        submission.setTeacherNote(teacherNote);
        submission.setStatus(AssignmentStatus.REVIEWED);
        dataStore.save();
    }

    @Override
    public void saveStudentCorrection(Submission submission, String correctedContent) throws Exception {
        if (submission == null) {
            throw new Exception("请选择作业");
        }
        if (!isTextSubmission(submission)) {
            throw new Exception("当前文件不支持在线订正");
        }
        if (correctedContent == null) {
            throw new Exception("订正内容不能为空");
        }
        submission.setOnlineReviewContent(correctedContent);
        submission.setOnlineStudentFixContent(null);
        submission.setStatus(AssignmentStatus.REVISED);
        dataStore.save();
    }

    @Override
    public File getSubmissionFile(Submission submission) {
        if (submission == null) {
            return null;
        }
        File studentDir = new File(submissionRoot, submission.getStudentUsername());
        return new File(studentDir, submission.getFileName());
    }

    @Override
    public File getReviewFile(Submission submission) {
        if (submission == null || submission.getReviewFileName() == null) {
            return null;
        }
        File studentDir = new File(reviewRoot, submission.getStudentUsername());
        return new File(studentDir, submission.getReviewFileName());
    }

    private static boolean isRichContent(String content) {
        return content != null && content.startsWith(RICH_MAGIC);
    }

    private static boolean isSameOwner(OnlineEditLock lock, String role, String username) {
        return role.equals(lock.getRole()) && username.equals(lock.getUsername());
    }

    private static boolean isLockExpired(OnlineEditLock lock, long nowMillis) {
        return nowMillis - lock.getLockedAtMillis() > ONLINE_EDIT_LOCK_TIMEOUT_MILLIS;
    }

    private static String toPlainText(String content) throws Exception {
        if (!isRichContent(content)) {
            return content;
        }
        String[] lines = content.split("\n", -1);
        StringBuilder result = new StringBuilder();
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i];
            if (line.isEmpty()) {
                continue;
            }
            int index = line.indexOf(':');
            if (index <= 0) {
                continue;
            }
            String b64 = line.substring(index + 1);
            if (b64.isEmpty()) {
                continue;
            }
            byte[] data = Base64.getDecoder().decode(b64);
            result.append(new String(data, StandardCharsets.UTF_8));
        }
        return result.toString();
    }

    private static String migrateLegacyToRich(String original, String teacherPlain, String studentPlain) {
        String base = original == null ? "" : original;
        String teacher = teacherPlain == null ? "" : teacherPlain;
        String student = studentPlain == null ? "" : studentPlain;

        if (teacher.isBlank() && student.isBlank()) {
            return buildRichFromRuns(new char[]{'O'}, new String[]{base});
        }

        if (!student.isBlank()) {
            Object[] runs = buildRunsByLine(base, teacher.isBlank() ? base : teacher, student);
            return buildRichFromRuns((char[]) runs[0], (String[]) runs[1]);
        }

        Object[] runs = buildRunsByLineSingleStage(base, teacher, 'T');
        return buildRichFromRuns((char[]) runs[0], (String[]) runs[1]);
    }

    private static Object[] buildRunsByLineSingleStage(String baseVersion, String targetVersion, char unmatchedSource) {
        List<String> baseLines = splitLinesPreserveNewline(baseVersion);
        List<String> targetLines = splitLinesPreserveNewline(targetVersion);
        int[] matchTargetToBase = lcsMatches(baseLines, targetLines);

        List<Character> runSources = new ArrayList<>();
        List<String> runTexts = new ArrayList<>();

        char currentSource = 0;
        StringBuilder currentText = new StringBuilder();
        for (int i = 0; i < targetLines.size(); i++) {
            char src = matchTargetToBase[i] >= 0 ? 'O' : unmatchedSource;
            if (currentSource == 0) {
                currentSource = src;
            }
            if (src != currentSource) {
                runSources.add(currentSource);
                runTexts.add(currentText.toString());
                currentText.setLength(0);
                currentSource = src;
            }
            currentText.append(targetLines.get(i));
        }
        if (currentSource != 0) {
            runSources.add(currentSource);
            runTexts.add(currentText.toString());
        }

        char[] finalSources = new char[runSources.size()];
        String[] finalTexts = new String[runTexts.size()];
        for (int i = 0; i < runSources.size(); i++) {
            finalSources[i] = runSources.get(i);
            finalTexts[i] = runTexts.get(i);
        }
        return new Object[]{finalSources, finalTexts};
    }

    private static Object[] buildRunsByLine(String original, String teacherVersion, String studentVersion) {
        List<String> originalLines = splitLinesPreserveNewline(original);
        List<String> teacherLines = splitLinesPreserveNewline(teacherVersion);
        int[] matchTeacherToOriginal = lcsMatches(originalLines, teacherLines);
        char[] teacherSources = new char[teacherLines.size()];
        for (int i = 0; i < teacherLines.size(); i++) {
            teacherSources[i] = matchTeacherToOriginal[i] >= 0 ? 'O' : 'T';
        }

        List<String> studentLines = splitLinesPreserveNewline(studentVersion);
        int[] matchStudentToTeacher = lcsMatches(teacherLines, studentLines);
        List<Character> runSources = new ArrayList<>();
        List<String> runTexts = new ArrayList<>();

        char currentSource = 0;
        StringBuilder currentText = new StringBuilder();
        for (int i = 0; i < studentLines.size(); i++) {
            int teacherIndex = matchStudentToTeacher[i];
            char src = teacherIndex >= 0 ? teacherSources[teacherIndex] : 'S';

            if (currentSource == 0) {
                currentSource = src;
            }
            if (src != currentSource) {
                runSources.add(currentSource);
                runTexts.add(currentText.toString());
                currentText.setLength(0);
                currentSource = src;
            }
            currentText.append(studentLines.get(i));
        }
        if (currentSource != 0) {
            runSources.add(currentSource);
            runTexts.add(currentText.toString());
        }

        char[] finalSources = new char[runSources.size()];
        String[] finalTexts = new String[runTexts.size()];
        for (int i = 0; i < runSources.size(); i++) {
            finalSources[i] = runSources.get(i);
            finalTexts[i] = runTexts.get(i);
        }

        return new Object[]{finalSources, finalTexts};
    }

    private static String buildRichFromRuns(char[] sources, String[] texts) {
        StringBuilder rich = new StringBuilder();
        rich.append(RICH_MAGIC);
        for (int i = 0; i < texts.length; i++) {
            String text = texts[i] == null ? "" : texts[i];
            String b64 = Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
            rich.append(sources[i]).append(':').append(b64).append('\n');
        }
        return rich.toString();
    }

    private static List<String> splitLinesPreserveNewline(String text) {
        List<String> lines = new ArrayList<>();
        if (text == null || text.isEmpty()) {
            return lines;
        }
        int start = 0;
        int length = text.length();
        for (int i = 0; i < length; i++) {
            if (text.charAt(i) == '\n') {
                lines.add(text.substring(start, i + 1));
                start = i + 1;
            }
        }
        if (start < length) {
            lines.add(text.substring(start));
        }
        return lines;
    }

    private static int[] lcsMatches(List<String> base, List<String> target) {
        int n = base.size();
        int m = target.size();
        int[][] dp = new int[n + 1][m + 1];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                if (base.get(i).equals(target.get(j))) {
                    dp[i][j] = dp[i + 1][j + 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
                }
            }
        }

        int[] match = new int[m];
        for (int i = 0; i < m; i++) {
            match[i] = -1;
        }

        int i = 0;
        int j = 0;
        while (i < n && j < m) {
            if (base.get(i).equals(target.get(j))) {
                match[j] = i;
                i++;
                j++;
            } else if (dp[i + 1][j] >= dp[i][j + 1]) {
                i++;
            } else {
                j++;
            }
        }
        return match;
    }
}
