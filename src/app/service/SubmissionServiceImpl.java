package app.service;

import app.model.AssignmentStatus;
import app.model.Submission;
import app.model.User;
import app.util.FileUtils;
import java.io.File;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

public class SubmissionServiceImpl implements SubmissionService {
    private final DataStore dataStore;
    private final File submissionRoot = new File("data/submissions");
    private final File reviewRoot = new File("data/reviews");

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
        submission.setOnlineStudentFixContent(correctedContent);
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
}
