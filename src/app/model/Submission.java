package app.model;

import java.io.Serializable;
import java.time.LocalDateTime;

public class Submission implements Serializable {
    private final String id;
    private final String studentUsername;
    private final String studentName;
    private final String fileName;
    private final LocalDateTime submitTime;
    private AssignmentStatus status;
    private String reviewFileName;
    private String teacherNote;
    private String onlineReviewContent;
    private String onlineStudentFixContent;

    public Submission(String id, String studentUsername, String studentName, String fileName, LocalDateTime submitTime) {
        this.id = id;
        this.studentUsername = studentUsername;
        this.studentName = studentName;
        this.fileName = fileName;
        this.submitTime = submitTime;
        this.status = AssignmentStatus.SUBMITTED;
    }

    public String getId() {
        return id;
    }

    public String getStudentUsername() {
        return studentUsername;
    }

    public String getStudentName() {
        return studentName;
    }

    public String getFileName() {
        return fileName;
    }

    public LocalDateTime getSubmitTime() {
        return submitTime;
    }

    public AssignmentStatus getStatus() {
        return status;
    }

    public void setStatus(AssignmentStatus status) {
        this.status = status;
    }

    public String getReviewFileName() {
        return reviewFileName;
    }

    public void setReviewFileName(String reviewFileName) {
        this.reviewFileName = reviewFileName;
    }

    public String getTeacherNote() {
        return teacherNote;
    }

    public void setTeacherNote(String teacherNote) {
        this.teacherNote = teacherNote;
    }

    public String getOnlineReviewContent() {
        return onlineReviewContent;
    }

    public void setOnlineReviewContent(String onlineReviewContent) {
        this.onlineReviewContent = onlineReviewContent;
    }

    public String getOnlineStudentFixContent() {
        return onlineStudentFixContent;
    }

    public void setOnlineStudentFixContent(String onlineStudentFixContent) {
        this.onlineStudentFixContent = onlineStudentFixContent;
    }
}
