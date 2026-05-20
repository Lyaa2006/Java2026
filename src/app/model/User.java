package app.model;

import java.io.Serializable;

public abstract class User implements Serializable {
    private final String username;
    private final String password;
    private final String displayName;

    protected User(String username, String password, String displayName) {
        this.username = username;
        this.password = password;
        this.displayName = displayName;
    }

    public String getUsername() {
        return username;
    }

    public String getPassword() {
        return password;
    }

    public String getDisplayName() {
        return displayName;
    }

    public abstract String getRole();
}
