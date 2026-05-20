package app.ui;

import app.model.User;
import javax.swing.JFrame;

public class DashboardFrame extends JFrame {
    public DashboardFrame(User user) {
        setTitle("作业互助批改平台 - " + user.getRole());
        setSize(900, 600);
        setLocationRelativeTo(null);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);

        if ("教师".equals(user.getRole())) {
            setContentPane(new TeacherPanel(user));
        } else {
            setContentPane(new StudentPanel(user));
        }
    }
}
