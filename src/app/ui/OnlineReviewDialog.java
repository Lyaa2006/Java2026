package app.ui;

import java.awt.Color;
import java.awt.BorderLayout;
import java.awt.FlowLayout;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JDialog;
import javax.swing.JLabel;
import javax.swing.JPanel;
import javax.swing.JScrollPane;
import javax.swing.JSplitPane;
import javax.swing.JTextArea;
import javax.swing.JTextPane;
import javax.swing.text.AbstractDocument;
import javax.swing.text.AttributeSet;
import javax.swing.text.BadLocationException;
import javax.swing.text.DocumentFilter;
import javax.swing.text.Element;
import javax.swing.text.SimpleAttributeSet;
import javax.swing.text.StyleConstants;
import javax.swing.text.StyledDocument;

public class OnlineReviewDialog extends JDialog {
    private final JTextArea noteArea;
    private final JTextPane filePane;
    private boolean saved;
    private static final String RICH_MAGIC = "RICH1\n";
    private static final String ATTR_SOURCE = "src";
    private final SimpleAttributeSet originalAttr;
    private final SimpleAttributeSet teacherAttr;
    private final SimpleAttributeSet studentAttr;

    public OnlineReviewDialog(java.awt.Window owner, String richContent, String note, boolean editable, String lockedByDisplay) {
        super(owner, "在线查看/编辑", ModalityType.APPLICATION_MODAL);
        setSize(900, 600);
        setLocationRelativeTo(owner);

        originalAttr = new SimpleAttributeSet();
        StyleConstants.setForeground(originalAttr, Color.BLACK);
        originalAttr.addAttribute(ATTR_SOURCE, 'O');

        teacherAttr = new SimpleAttributeSet();
        StyleConstants.setForeground(teacherAttr, new Color(220, 0, 0));
        teacherAttr.addAttribute(ATTR_SOURCE, 'T');

        studentAttr = new SimpleAttributeSet();
        StyleConstants.setForeground(studentAttr, new Color(0, 88, 220));
        studentAttr.addAttribute(ATTR_SOURCE, 'S');

        filePane = new JTextPane();
        filePane.setEditable(editable);
        if (editable) {
            ((AbstractDocument) filePane.getDocument()).setDocumentFilter(new RoleColorFilter(teacherAttr));
        }
        loadRichContent(richContent);

        noteArea = new JTextArea(note == null ? "" : note, 3, 20);
        noteArea.setEditable(true);

        JPanel leftPanel = new JPanel(new BorderLayout(8, 8));
        JLabel leftTitle = new JLabel("文件内容（可编辑）");
        if (!editable && lockedByDisplay != null && !lockedByDisplay.isBlank()) {
            leftTitle.setText("文件内容（只读：对方正在编辑 " + lockedByDisplay + "）");
        }
        leftPanel.add(leftTitle, BorderLayout.NORTH);
        leftPanel.add(new JScrollPane(filePane), BorderLayout.CENTER);

        JPanel rightPanel = new JPanel(new BorderLayout(8, 8));
        rightPanel.setBorder(BorderFactory.createEmptyBorder(0, 8, 0, 0));
        rightPanel.add(new JLabel("评语（教师可编辑）"), BorderLayout.NORTH);
        rightPanel.add(new JScrollPane(noteArea), BorderLayout.CENTER);

        JSplitPane splitPane = new JSplitPane(JSplitPane.HORIZONTAL_SPLIT, leftPanel, rightPanel);
        splitPane.setResizeWeight(0.7);

        JPanel buttonPanel = new JPanel(new FlowLayout(FlowLayout.RIGHT));
        JButton saveButton = new JButton("保存");
        JButton cancelButton = new JButton("关闭");
        buttonPanel.add(saveButton);
        buttonPanel.add(cancelButton);

        cancelButton.addActionListener(event -> dispose());
        saveButton.addActionListener(event -> {
            saved = true;
            dispose();
        });
        saveButton.setEnabled(editable);

        add(splitPane, BorderLayout.CENTER);
        add(buttonPanel, BorderLayout.SOUTH);
    }

    public boolean isSaved() {
        return saved;
    }

    public String getRichContent() throws Exception {
        StyledDocument doc = filePane.getStyledDocument();
        StringBuilder rich = new StringBuilder();
        rich.append(RICH_MAGIC);
        int pos = 0;
        while (pos < doc.getLength()) {
            Element element = doc.getCharacterElement(pos);
            int start = element.getStartOffset();
            int end = Math.min(element.getEndOffset(), doc.getLength());
            AttributeSet attrs = element.getAttributes();
            Object source = attrs.getAttribute(ATTR_SOURCE);
            char src = source instanceof Character ? (Character) source : 'O';
            String text = doc.getText(start, end - start);
            String b64 = Base64.getEncoder().encodeToString(text.getBytes(StandardCharsets.UTF_8));
            rich.append(src).append(':').append(b64).append('\n');
            pos = end;
        }
        return rich.toString();
    }

    public String getPlainContent() throws Exception {
        return filePane.getDocument().getText(0, filePane.getDocument().getLength());
    }

    public String getNote() {
        return noteArea.getText().trim();
    }

    private void loadRichContent(String richContent) {
        StyledDocument doc = filePane.getStyledDocument();
        try {
            doc.remove(0, doc.getLength());
            if (richContent == null || richContent.isBlank()) {
                return;
            }
            if (!richContent.startsWith(RICH_MAGIC)) {
                doc.insertString(0, richContent, originalAttr);
                return;
            }
            String[] lines = richContent.split("\n", -1);
            for (int i = 1; i < lines.length; i++) {
                String line = lines[i];
                if (line.isEmpty()) {
                    continue;
                }
                int index = line.indexOf(':');
                if (index <= 0) {
                    continue;
                }
                char src = line.charAt(0);
                String b64 = line.substring(index + 1);
                if (b64.isEmpty()) {
                    continue;
                }
                String text = new String(Base64.getDecoder().decode(b64), StandardCharsets.UTF_8);
                doc.insertString(doc.getLength(), text, attrForSource(src));
            }
        } catch (Exception ignored) {
        }
    }

    private SimpleAttributeSet attrForSource(char src) {
        if (src == 'T') {
            return teacherAttr;
        }
        if (src == 'S') {
            return studentAttr;
        }
        return originalAttr;
    }

    private static class RoleColorFilter extends DocumentFilter {
        private final AttributeSet roleAttr;

        private RoleColorFilter(AttributeSet roleAttr) {
            this.roleAttr = roleAttr;
        }

        @Override
        public void insertString(FilterBypass fb, int offset, String string, AttributeSet attr) throws BadLocationException {
            fb.insertString(offset, string, roleAttr);
        }

        @Override
        public void replace(FilterBypass fb, int offset, int length, String text, AttributeSet attrs) throws BadLocationException {
            fb.replace(offset, length, text, roleAttr);
        }
    }
}
