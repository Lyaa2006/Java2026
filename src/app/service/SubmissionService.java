package app.service;

import app.model.Submission;
import app.model.User;
import java.io.File;
import java.util.List;

public interface SubmissionService {
    Submission submit(User student, File file) throws Exception;

    List<Submission> listForStudent(String username);

    List<Submission> listAll();

    void addReview(Submission submission, File reviewFile, String teacherNote) throws Exception;

    boolean isTextSubmission(Submission submission);

    String loadSubmissionText(Submission submission) throws Exception;

    void saveOnlineReview(Submission submission, String reviewedContent, String teacherNote) throws Exception;

    void saveStudentCorrection(Submission submission, String correctedContent) throws Exception;

    File getSubmissionFile(Submission submission);

    File getReviewFile(Submission submission);
}
