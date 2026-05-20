package app.ui;

import java.awt.BorderLayout;
import java.awt.FlowLayout;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;

public class OnlineCorrectionDialog extends JDialog {
    private final JTextArea correctionArea;
    private boolean saved;

    public OnlineCorrectionDialog(java.awt.Window owner, String originalContent, String reviewContent, String correctionContent) {
        super(owner, "在线订正", ModalityType.APPLICATION_MODAL);
        setSize(900, 600);
        setLocationRelativeTo(owner);

        JTextArea reviewArea = new JTextArea(reviewContent == null ? "" : reviewContent);
        reviewArea.setEditable(false);
        JTextArea originalArea = new JTextArea(originalContent == null ? "" : originalContent);
        originalArea.setEditable(false);
        correctionArea = new JTextArea(correctionContent == null ? "" : correctionContent);

        JTabbedPane topTabs = new JTabbedPane();
        topTabs.addTab("教师批改", new JScrollPane(reviewArea));
        topTabs.addTab("原始作业", new JScrollPane(originalArea));

        JSplitPane splitPane = new JSplitPane(JSplitPane.VERTICAL_SPLIT,
            topTabs, new JScrollPane(correctionArea));
        splitPane.setResizeWeight(0.6);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("提交订正");
        JButton cancelButton = new JButton("取消");
        buttonPanel.add(cancelButton);
        buttonPanel.add(saveButton);

        cancelButton.addActionListener(event -> dispose());
        saveButton.addActionListener(event -> {
            saved = true;
            dispose();
        });

        add(splitPane, BorderLayout.CENTER);
        add(buttonPanel, BorderLayout.SOUTH);
    }

    public boolean isSaved() {
        return saved;
    }

    public String getCorrectionContent() {
        return correctionArea.getText();
    }
}
