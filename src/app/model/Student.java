package app.model;

public class Student extends User {
    public Student(String username, String password, String displayName) {
        super(username, password, displayName);
    }

    @Override
    public String getRole() {
        return "学生";
    }
}
