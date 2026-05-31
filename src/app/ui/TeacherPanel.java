package app.ui;

import app.AppContext;
import app.model.Submission;
import app.model.User;
import app.service.SubmissionService;
import app.util.FileUtils;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.io.File;
import java.util.List;
import javax.swing.JButton;
import javax.swing.JFileChooser;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTable;
import javax.swing.JTextArea;
import javax.swing.SwingWorker;
import javax.swing.filechooser.FileNameExtensionFilter;

public class TeacherPanel extends JPanel {
    private final User teacher;
    private final SubmissionService submissionService;
    private final SubmissionTableModel tableModel;
    private final JTable table;
    private final JLabel statusLabel;

    public TeacherPanel(User teacher) {
        this.teacher = teacher;
        this.submissionService = AppContext.getSubmissionService();
        this.tableModel = new SubmissionTableModel(new String[]{"编号", "学生", "文件", "状态", "提交时间", "教师批注"});
        this.table = new JTable(tableModel);
        this.statusLabel = new JLabel("欢迎，" + teacher.getDisplayName());

        setLayout(new BorderLayout(10, 10));
        add(buildToolbar(), BorderLayout.NORTH);
        add(new JScrollPane(table), BorderLayout.CENTER);
        add(statusLabel, BorderLayout.SOUTH);

        refreshList();
    }

    private JPanel buildToolbar() {
        JPanel panel = new JPanel(new FlowLayout(FlowLayout.LEFT));
        JButton downloadButton = new JButton("下载作业");
        JButton uploadReviewButton = new JButton("上传批改文件");
        JButton onlineReviewButton = new JButton("在线查看/批改");
        JButton refreshButton = new JButton("刷新");

        downloadButton.addActionListener(event -> downloadSubmission());
        uploadReviewButton.addActionListener(event -> uploadReview());
        onlineReviewButton.addActionListener(event -> openOnlineReview());
        refreshButton.addActionListener(event -> refreshList());

        panel.add(downloadButton);
        panel.add(uploadReviewButton);
        panel.add(onlineReviewButton);
        panel.add(refreshButton);
        return panel;
    }

    private void downloadSubmission() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        File source = submissionService.getSubmissionFile(submission);
        if (source == null || !source.exists()) {
            JOptionPane.showMessageDialog(this, "作业文件不存在", "提示", JOptionPane.WARNING_MESSAGE);
            return;
        }
        JFileChooser chooser = new JFileChooser();
        chooser.setSelectedFile(new File(source.getName()));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) {
            return;
        }
        File target = chooser.getSelectedFile();
        statusLabel.setText("正在下载: " + source.getName());
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                if (submissionService.isTextSubmission(submission) && submission.getOnlineReviewContent() != null && !submission.getOnlineReviewContent().isBlank()) {
                    String content = submissionService.exportOnlineEditablePlainText(submission);
                    FileUtils.writeText(target, content);
                } else {
                    FileUtils.copyFile(source, target);
                }
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(TeacherPanel.this, "下载完成", "提示", JOptionPane.INFORMATION_MESSAGE);
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(TeacherPanel.this, "下载失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    statusLabel.setText("欢迎，" + teacher.getDisplayName());
                }
            }
        }.execute();
    }

    private void uploadReview() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        JFileChooser chooser = new JFileChooser();
        chooser.setFileFilter(new FileNameExtensionFilter("批改文件", "pdf", "doc", "docx", "zip", "txt"));
        if (chooser.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) {
            return;
        }
        File reviewFile = chooser.getSelectedFile();
        JTextArea noteArea = new JTextArea(4, 24);
        int option = JOptionPane.showConfirmDialog(this, new JScrollPane(noteArea), "填写批注（可选）", JOptionPane.OK_CANCEL_OPTION);
        if (option != JOptionPane.OK_OPTION) {
            return;
        }
        String note = noteArea.getText().trim();
        statusLabel.setText("正在回传批改: " + reviewFile.getName());
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                submissionService.addReview(submission, reviewFile, note.isEmpty() ? null : note);
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(TeacherPanel.this, "批改已回传", "提示", JOptionPane.INFORMATION_MESSAGE);
                    refreshList();
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(TeacherPanel.this, "回传失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    statusLabel.setText("欢迎，" + teacher.getDisplayName());
                }
            }
        }.execute();
    }

    private void openOnlineReview() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        if (!submissionService.isTextSubmission(submission)) {
            JOptionPane.showMessageDialog(this, "当前文件类型不支持在线批改", "提示", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        statusLabel.setText("正在加载作业内容...");
        new SwingWorker<Object[], Void>() {
            @Override
            protected Object[] doInBackground() throws Exception {
                String original = submissionService.loadSubmissionText(submission);
                String rich = submissionService.ensureOnlineEditableContent(submission, original);
                String lockedBy = submissionService.tryAcquireOnlineEditLock(submission, "TEACHER", teacher.getUsername());
                return new Object[]{rich, lockedBy};
            }

            @Override
            protected void done() {
                String lockedBy = null;
                try {
                    Object[] data = get();
                    String rich = (String) data[0];
                    lockedBy = (String) data[1];
                    boolean editable = lockedBy == null;
                    OnlineReviewDialog dialog = new OnlineReviewDialog(
                        javax.swing.SwingUtilities.getWindowAncestor(TeacherPanel.this),
                        rich,
                        submission.getTeacherNote(),
                        editable,
                        lockedBy
                    );
                    dialog.setVisible(true);
                    if (editable) {
                        if (dialog.isSaved()) {
                            String richToSave = dialog.getRichContent();
                            String note = dialog.getNote();
                            saveOnlineReview(submission, richToSave, note.isEmpty() ? null : note);
                        } else {
                            submissionService.releaseOnlineEditLock(submission, "TEACHER", teacher.getUsername());
                        }
                    }
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(TeacherPanel.this, "加载失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                    if (lockedBy == null) {
                        submissionService.releaseOnlineEditLock(submission, "TEACHER", teacher.getUsername());
                    }
                } finally {
                    statusLabel.setText("欢迎，" + teacher.getDisplayName());
                }
            }
        }.execute();
    }

    private void saveOnlineReview(Submission submission, String richContent, String note) {
        statusLabel.setText("正在保存在线批改...");
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                submissionService.saveOnlineReview(submission, richContent, note);
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(TeacherPanel.this, "在线批改已保存", "提示", JOptionPane.INFORMATION_MESSAGE);
                    refreshList();
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(TeacherPanel.this, "保存失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    submissionService.releaseOnlineEditLock(submission, "TEACHER", teacher.getUsername());
                    statusLabel.setText("欢迎，" + teacher.getDisplayName());
                }
            }
        }.execute();
    }

    private Submission getSelectedSubmission() {
        int row = table.getSelectedRow();
        if (row < 0) {
            JOptionPane.showMessageDialog(this, "请选择一条作业记录", "提示", JOptionPane.WARNING_MESSAGE);
            return null;
        }
        return tableModel.getSubmissionAt(row);
    }

    private void refreshList() {
        List<Submission> submissions = submissionService.listAll();
        tableModel.setSubmissions(submissions);
        statusLabel.setText("已加载 " + submissions.size() + " 条记录");
    }
}
