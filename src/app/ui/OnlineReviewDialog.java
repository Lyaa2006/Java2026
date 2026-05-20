package app.ui;

import java.awt.BorderLayout;
import java.awt.FlowLayout;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextArea;

public class OnlineReviewDialog extends JDialog {
    private final JTextArea reviewArea;
    private final JTextArea noteArea;
    private boolean saved;

    public OnlineReviewDialog(java.awt.Window owner, String originalContent, String reviewContent, String note) {
        super(owner, "在线批改", ModalityType.APPLICATION_MODAL);
        setSize(900, 600);
        setLocationRelativeTo(owner);

        JTextArea originalArea = new JTextArea(originalContent == null ? "" : originalContent);
        originalArea.setEditable(false);
        reviewArea = new JTextArea(reviewContent == null ? "" : reviewContent);
        noteArea = new JTextArea(note == null ? "" : note, 3, 20);

        JSplitPane splitPane = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT,
            new JScrollPane(originalArea), new JScrollPane(reviewArea));
        splitPane.setResizeWeight(0.5);

        JPanel notePanel = new JPanel(new BorderLayout(8, 8));
        notePanel.add(new JLabel("教师批注（可选）"), BorderLayout.NORTH);
        notePanel.add(new JScrollPane(noteArea), BorderLayout.CENTER);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("保存批改");
        JButton cancelButton = new JButton("取消");
        buttonPanel.add(cancelButton);
        buttonPanel.add(saveButton);

        cancelButton.addActionListener(event -> dispose());
        saveButton.addActionListener(event -> {
            saved = true;
            dispose();
        });

        add(splitPane, BorderLayout.CENTER);
        add(notePanel, BorderLayout.SOUTH);
        add(buttonPanel, BorderLayout.NORTH);
    }

    public boolean isSaved() {
        return saved;
    }

    public String getReviewContent() {
        return reviewArea.getText();
    }

    public String getNote() {
        return noteArea.getText().trim();
    }
}
