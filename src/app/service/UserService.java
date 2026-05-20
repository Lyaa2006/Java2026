package app.service;

import app.model.User;

public interface UserService {
    User login(String username, String password);

    User register(String role, String username, String password, String displayName) throws Exception;
}
