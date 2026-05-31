package app.service;

import app.model.Submission;
import app.model.Teacher;
import app.model.User;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.ObjectInputStream;
import java.io.ObjectOutputStream;
import java.io.Serializable;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class DataStore {
    private final Map<String, User> users = new HashMap<>();
    private final List<Submission> submissions = new ArrayList<>();
    private final Map<String, OnlineEditLock> onlineEditLocks = new HashMap<>();
    private final File dataDir = new File("data");
    private final File usersFile = new File(dataDir, "users.dat");
    private final File submissionsFile = new File(dataDir, "submissions.dat");
    private final File onlineEditLocksFile = new File(dataDir, "online_edit_locks.dat");

    public synchronized Map<String, User> getUsers() {
        return users;
    }

    public synchronized List<Submission> getSubmissions() {
        return submissions;
    }

    public synchronized OnlineEditLock getOnlineEditLock(String submissionId) {
        return onlineEditLocks.get(submissionId);
    }

    public synchronized void putOnlineEditLock(String submissionId, OnlineEditLock lock) {
        if (lock == null) {
            onlineEditLocks.remove(submissionId);
        } else {
            onlineEditLocks.put(submissionId, lock);
        }
    }

    public synchronized void load() {
        if (!dataDir.exists()) {
            dataDir.mkdirs();
        }
        loadUsers();
        loadSubmissions();
        loadOnlineEditLocks();
        ensureDefaultTeacher();
    }

    public synchronized void save() {
        saveUsers();
        saveSubmissions();
        saveOnlineEditLocks();
    }

    private void loadUsers() {
        users.clear();
        if (!usersFile.exists()) {
            return;
        }
        try (ObjectInputStream inputStream = new ObjectInputStream(new FileInputStream(usersFile))) {
            Object obj = inputStream.readObject();
            if (obj instanceof Map) {
                users.putAll((Map<String, User>) obj);
            }
        } catch (Exception ignored) {
        }
    }

    private void loadSubmissions() {
        submissions.clear();
        if (!submissionsFile.exists()) {
            return;
        }
        try (ObjectInputStream inputStream = new ObjectInputStream(new FileInputStream(submissionsFile))) {
            Object obj = inputStream.readObject();
            if (obj instanceof List) {
                submissions.addAll((List<Submission>) obj);
            }
        } catch (Exception ignored) {
        }
    }

    private void loadOnlineEditLocks() {
        onlineEditLocks.clear();
        if (!onlineEditLocksFile.exists()) {
            return;
        }
        try (ObjectInputStream inputStream = new ObjectInputStream(new FileInputStream(onlineEditLocksFile))) {
            Object obj = inputStream.readObject();
            if (obj instanceof Map) {
                onlineEditLocks.putAll((Map<String, OnlineEditLock>) obj);
            }
        } catch (Exception ignored) {
        }
    }

    private void saveUsers() {
        try (ObjectOutputStream outputStream = new ObjectOutputStream(new FileOutputStream(usersFile))) {
            outputStream.writeObject(users);
        } catch (Exception ignored) {
        }
    }

    private void saveSubmissions() {
        try (ObjectOutputStream outputStream = new ObjectOutputStream(new FileOutputStream(submissionsFile))) {
            outputStream.writeObject(submissions);
        } catch (Exception ignored) {
        }
    }

    private void saveOnlineEditLocks() {
        try (ObjectOutputStream outputStream = new ObjectOutputStream(new FileOutputStream(onlineEditLocksFile))) {
            outputStream.writeObject(onlineEditLocks);
        } catch (Exception ignored) {
        }
    }

    private void ensureDefaultTeacher() {
        if (users.values().stream().noneMatch(user -> "教师".equals(user.getRole()))) {
            Teacher teacher = new Teacher("teacher", "123456", "默认教师");
            users.put(teacher.getUsername(), teacher);
            saveUsers();
        }
    }
}

class OnlineEditLock implements Serializable {
    private final String role;
    private final String username;
    private final long lockedAtMillis;

    public OnlineEditLock(String role, String username, long lockedAtMillis) {
        this.role = role;
        this.username = username;
        this.lockedAtMillis = lockedAtMillis;
    }

    public String getRole() {
        return role;
    }

    public String getUsername() {
        return username;
    }

    public long getLockedAtMillis() {
        return lockedAtMillis;
    }
}
