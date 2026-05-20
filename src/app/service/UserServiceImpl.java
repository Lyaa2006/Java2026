package app.service;

import app.model.Student;
import app.model.Teacher;
import app.model.User;

public class UserServiceImpl implements UserService {
    private final DataStore dataStore;

    public UserServiceImpl(DataStore dataStore) {
        this.dataStore = dataStore;
    }

    @Override
    public User login(String username, String password) {
        User user = dataStore.getUsers().get(username);
        if (user != null && user.getPassword().equals(password)) {
            return user;
        }
        return null;
    }

    @Override
    public User register(String role, String username, String password, String displayName) throws Exception {
        if (username == null || username.isBlank()) {
            throw new Exception("用户名不能为空");
        }
        if (password == null || password.length() < 4) {
            throw new Exception("密码至少4位");
        }
        if (dataStore.getUsers().containsKey(username)) {
            throw new Exception("用户名已存在");
        }
        User user;
        if ("教师".equals(role)) {
            user = new Teacher(username, password, displayName);
        } else {
            user = new Student(username, password, displayName);
        }
        dataStore.getUsers().put(username, user);
        dataStore.save();
        return user;
    }
}
