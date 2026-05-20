package app.model;

public enum AssignmentStatus {
    SUBMITTED("已提交"),
    REVIEWED("已批改"),
    REVISED("已订正");

    private final String label;

    AssignmentStatus(String label) {
        this.label = label;
    }

    public String getLabel() {
        return label;
    }
}
