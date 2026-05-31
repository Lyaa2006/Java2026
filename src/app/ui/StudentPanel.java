package app.ui;

import app.AppContext;
import app.model.Submission;
import app.model.User;
import app.service.SubmissionService;
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
import javax.swing.SwingWorker;
import javax.swing.filechooser.FileNameExtensionFilter;

public class StudentPanel extends JPanel {
    private final User student;
    private final SubmissionService submissionService;
    private final SubmissionTableModel tableModel;
    private final JTable table;
    private final JLabel statusLabel;

    public StudentPanel(User student) {
        this.student = student;
        this.submissionService = AppContext.getSubmissionService();
        this.tableModel = new SubmissionTableModel(new String[]{"编号", "学生", "文件", "状态", "提交时间", "教师批注"});
        this.table = new JTable(tableModel);
        this.statusLabel = new JLabel("欢迎，" + student.getDisplayName());

        setLayout(new BorderLayout(10, 10));
        add(buildToolbar(), BorderLayout.NORTH);
        add(new JScrollPane(table), BorderLayout.CENTER);
        add(statusLabel, BorderLayout.SOUTH);

        refreshList();
    }

    private JPanel buildToolbar() {
        JPanel panel = new JPanel(new FlowLayout(FlowLayout.LEFT));
        JButton uploadButton = new JButton("上传作业");
        JButton downloadReviewButton = new JButton("下载批改文件");
        JButton onlineReviewButton = new JButton("在线查看批改");
        JButton correctionButton = new JButton("在线订正");
        JButton refreshButton = new JButton("刷新");
        JButton detailButton = new JButton("查看详情");

        uploadButton.addActionListener(event -> uploadSubmission());
        downloadReviewButton.addActionListener(event -> downloadReview());
        onlineReviewButton.addActionListener(event -> openOnlineReview());
        correctionButton.addActionListener(event -> openOnlineCorrection());
        refreshButton.addActionListener(event -> refreshList());
        detailButton.addActionListener(event -> showDetail());

        panel.add(uploadButton);
        panel.add(downloadReviewButton);
        panel.add(onlineReviewButton);
        panel.add(correctionButton);
        panel.add(detailButton);
        panel.add(refreshButton);
        return panel;
    }

    private void uploadSubmission() {
        JFileChooser chooser = new JFileChooser();
        chooser.setFileFilter(new FileNameExtensionFilter("作业文件", "pdf", "doc", "docx", "zip", "java", "txt"));
        if (chooser.showOpenDialog(this) != JFileChooser.APPROVE_OPTION) {
            return;
        }
        File selected = chooser.getSelectedFile();
        statusLabel.setText("正在上传: " + selected.getName());
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                submissionService.submit(student, selected);
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(StudentPanel.this, "上传成功", "提示", JOptionPane.INFORMATION_MESSAGE);
                    refreshList();
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(StudentPanel.this, "上传失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    statusLabel.setText("欢迎，" + student.getDisplayName());
                }
            }
        }.execute();
    }

    private void downloadReview() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        if (submissionService.isTextSubmission(submission) && submission.getOnlineReviewContent() != null && !submission.getOnlineReviewContent().isBlank()) {
            JFileChooser chooser = new JFileChooser();
            File source = submissionService.getSubmissionFile(submission);
            chooser.setSelectedFile(new File(source == null ? "edited.txt" : source.getName()));
            if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) {
                return;
            }
            File target = chooser.getSelectedFile();
            statusLabel.setText("正在下载编辑后的文本...");
            new SwingWorker<Void, Void>() {
                @Override
                protected Void doInBackground() throws Exception {
                    String content = submissionService.exportOnlineEditablePlainText(submission);
                    app.util.FileUtils.writeText(target, content);
                    return null;
                }

                @Override
                protected void done() {
                    try {
                        get();
                        JOptionPane.showMessageDialog(StudentPanel.this, "下载完成", "提示", JOptionPane.INFORMATION_MESSAGE);
                    } catch (Exception ex) {
                        JOptionPane.showMessageDialog(StudentPanel.this, "下载失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                    } finally {
                        statusLabel.setText("欢迎，" + student.getDisplayName());
                    }
                }
            }.execute();
            return;
        }
        File reviewFile = submissionService.getReviewFile(submission);
        if (reviewFile == null || !reviewFile.exists()) {
            JOptionPane.showMessageDialog(this, "暂无批改文件", "提示", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        JFileChooser chooser = new JFileChooser();
        chooser.setSelectedFile(new File(reviewFile.getName()));
        if (chooser.showSaveDialog(this) != JFileChooser.APPROVE_OPTION) {
            return;
        }
        File target = chooser.getSelectedFile();
        statusLabel.setText("正在下载: " + reviewFile.getName());
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                app.util.FileUtils.copyFile(reviewFile, target);
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(StudentPanel.this, "下载完成", "提示", JOptionPane.INFORMATION_MESSAGE);
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(StudentPanel.this, "下载失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    statusLabel.setText("欢迎，" + student.getDisplayName());
                }
            }
        }.execute();
    }

    private void showDetail() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        String message = "状态: " + submission.getStatus().getLabel() + "\n" +
            "教师批注: " + (submission.getTeacherNote() == null ? "暂无" : submission.getTeacherNote());
        JOptionPane.showMessageDialog(this, message, "作业详情", JOptionPane.INFORMATION_MESSAGE);
    }

    private void openOnlineReview() {
        openOnlineEditor();
    }

    private void openOnlineCorrection() {
        openOnlineEditor();
    }

    private void openOnlineEditor() {
        Submission submission = getSelectedSubmission();
        if (submission == null) {
            return;
        }
        if (!submissionService.isTextSubmission(submission)) {
            JOptionPane.showMessageDialog(this, "当前文件类型不支持在线编辑", "提示", JOptionPane.INFORMATION_MESSAGE);
            return;
        }
        statusLabel.setText("正在打开在线编辑界面...");
        new SwingWorker<Object[], Void>() {
            @Override
            protected Object[] doInBackground() throws Exception {
                String original = submissionService.loadSubmissionText(submission);
                String rich = submissionService.ensureOnlineEditableContent(submission, original);
                String lockedBy = submissionService.tryAcquireOnlineEditLock(submission, "STUDENT", student.getUsername());
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
                    OnlineCorrectionDialog dialog = new OnlineCorrectionDialog(
                        javax.swing.SwingUtilities.getWindowAncestor(StudentPanel.this),
                        rich,
                        submission.getTeacherNote(),
                        editable,
                        lockedBy
                    );
                    dialog.setVisible(true);
                    if (editable) {
                        if (dialog.isSaved()) {
                            String richToSave = dialog.getRichContent();
                            saveStudentCorrection(submission, richToSave);
                        } else {
                            submissionService.releaseOnlineEditLock(submission, "STUDENT", student.getUsername());
                        }
                    }
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(StudentPanel.this, "加载失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                    if (lockedBy == null) {
                        submissionService.releaseOnlineEditLock(submission, "STUDENT", student.getUsername());
                    }
                } finally {
                    statusLabel.setText("欢迎，" + student.getDisplayName());
                }
            }
        }.execute();
    }

    private void saveStudentCorrection(Submission submission, String richContent) {
        statusLabel.setText("正在保存...");
        new SwingWorker<Void, Void>() {
            @Override
            protected Void doInBackground() throws Exception {
                submissionService.saveStudentCorrection(submission, richContent);
                return null;
            }

            @Override
            protected void done() {
                try {
                    get();
                    JOptionPane.showMessageDialog(StudentPanel.this, "已保存", "提示", JOptionPane.INFORMATION_MESSAGE);
                    refreshList();
                } catch (Exception ex) {
                    JOptionPane.showMessageDialog(StudentPanel.this, "保存失败: " + ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
                } finally {
                    submissionService.releaseOnlineEditLock(submission, "STUDENT", student.getUsername());
                    statusLabel.setText("欢迎，" + student.getDisplayName());
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
        List<Submission> submissions = submissionService.listForStudent(student.getUsername());
        tableModel.setSubmissions(submissions);
        statusLabel.setText("已加载 " + submissions.size() + " 条记录");
    }
}
