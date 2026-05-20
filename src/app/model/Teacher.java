package app.model;

public class Teacher extends User {
    public Teacher(String username, String password, String displayName) {
        super(username, password, displayName);
    }

    @Override
    public String getRole() {
        return "教师";
    }
}
