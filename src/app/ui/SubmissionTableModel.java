package app.ui;

import app.model.Submission;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;
import javax.swing.table.AbstractTableModel;

public class SubmissionTableModel extends AbstractTableModel {
    private final String[] columns;
    private final List<Submission> submissions = new ArrayList<>();
    private final DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm");

    public SubmissionTableModel(String[] columns) {
        this.columns = columns;
    }

    public void setSubmissions(List<Submission> data) {
        submissions.clear();
        if (data != null) {
            submissions.addAll(data);
        }
        fireTableDataChanged();
    }

    public Submission getSubmissionAt(int row) {
        if (row < 0 || row >= submissions.size()) {
            return null;
        }
        return submissions.get(row);
    }

    @Override
    public int getRowCount() {
        return submissions.size();
    }

    @Override
    public int getColumnCount() {
        return columns.length;
    }

    @Override
    public String getColumnName(int column) {
        return columns[column];
    }

    @Override
    public Object getValueAt(int rowIndex, int columnIndex) {
        Submission submission = submissions.get(rowIndex);
        return switch (columnIndex) {
            case 0 -> submission.getId();
            case 1 -> submission.getStudentName();
            case 2 -> submission.getFileName();
            case 3 -> submission.getStatus().getLabel();
            case 4 -> formatter.format(submission.getSubmitTime());
            case 5 -> submission.getTeacherNote() == null ? "-" : submission.getTeacherNote();
            default -> "";
        };
    }
}
