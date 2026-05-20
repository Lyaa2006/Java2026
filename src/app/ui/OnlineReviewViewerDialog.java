package app.ui;

import java.awt.BorderLayout;
import java.awt.FlowLayout;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JTabbedPane;
import javax.swing.JTextArea;

public class OnlineReviewViewerDialog extends JDialog {
    public OnlineReviewViewerDialog(java.awt.Window owner, String originalContent, String reviewContent) {
        super(owner, "在线查看批改", ModalityType.APPLICATION_MODAL);
        setSize(900, 600);
        setLocationRelativeTo(owner);

        JTextArea reviewArea = new JTextArea(reviewContent == null ? "" : reviewContent);
        reviewArea.setEditable(false);
        JTextArea originalArea = new JTextArea(originalContent == null ? "" : originalContent);
        originalArea.setEditable(false);

        JTabbedPane tabs = new JTabbedPane();
        tabs.addTab("教师批改", new JScrollPane(reviewArea));
        tabs.addTab("原始作业", new JScrollPane(originalArea));

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton closeButton = new JButton("关闭");
        closeButton.addActionListener(event -> dispose());
        buttonPanel.add(closeButton);

        add(tabs, BorderLayout.CENTER);
        add(buttonPanel, BorderLayout.SOUTH);
    }
}
