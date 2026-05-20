package app.ui;

import app.AppContext;
import app.model.User;
import java.awt.BorderLayout;
import java.awt.GridLayout;
import javax.swing.BorderFactory;
import javax.swing.JButton;
import javax.swing.JComboBox;
import javax.swing.JFrame;
import javax.swing.JLabel;
import javax.swing.JOptionPane;
import javax.swing.JPanel;
import javax.swing.JPasswordField;
import javax.swing.JTabbedPane;
import javax.swing.JTextField;

public class LoginFrame extends JFrame {
    public LoginFrame() {
        setTitle("作业互助批改平台 - 登录/注册");
        setSize(480, 360);
        setLocationRelativeTo(null);
        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);

        JTabbedPane tabbedPane = new JTabbedPane();
        tabbedPane.addTab("登录", buildLoginPanel());
        tabbedPane.addTab("注册", buildRegisterPanel());

        add(tabbedPane, BorderLayout.CENTER);
    }

    private JPanel buildLoginPanel() {
        JPanel panel = new JPanel(new BorderLayout());
        JPanel form = new JPanel(new GridLayout(3, 2, 8, 8));
        form.setBorder(BorderFactory.createEmptyBorder(30, 40, 30, 40));

        JTextField usernameField = new JTextField();
        JPasswordField passwordField = new JPasswordField();

        form.add(new JLabel("用户名"));
        form.add(usernameField);
        form.add(new JLabel("密码"));
        form.add(passwordField);

        JButton loginButton = new JButton("登录");
        form.add(new JLabel(""));
        form.add(loginButton);

        loginButton.addActionListener(event -> {
            String username = usernameField.getText().trim();
            String password = new String(passwordField.getPassword());
            User user = AppContext.getUserService().login(username, password);
            if (user == null) {
                JOptionPane.showMessageDialog(this, "用户名或密码错误", "提示", JOptionPane.WARNING_MESSAGE);
                return;
            }
            openDashboard(user);
        });

        panel.add(form, BorderLayout.CENTER);
        return panel;
    }

    private JPanel buildRegisterPanel() {
        JPanel panel = new JPanel(new BorderLayout());
        JPanel form = new JPanel(new GridLayout(5, 2, 8, 8));
        form.setBorder(BorderFactory.createEmptyBorder(20, 40, 20, 40));

        JTextField usernameField = new JTextField();
        JPasswordField passwordField = new JPasswordField();
        JTextField displayNameField = new JTextField();
        JComboBox<String> roleBox = new JComboBox<>(new String[]{"学生", "教师"});

        form.add(new JLabel("用户名"));
        form.add(usernameField);
        form.add(new JLabel("密码"));
        form.add(passwordField);
        form.add(new JLabel("姓名"));
        form.add(displayNameField);
        form.add(new JLabel("角色"));
        form.add(roleBox);

        JButton registerButton = new JButton("注册并登录");
        form.add(new JLabel(""));
        form.add(registerButton);

        registerButton.addActionListener(event -> {
            try {
                User user = AppContext.getUserService().register(
                    roleBox.getSelectedItem().toString(),
                    usernameField.getText().trim(),
                    new String(passwordField.getPassword()),
                    displayNameField.getText().trim()
                );
                JOptionPane.showMessageDialog(this, "注册成功，已登录", "提示", JOptionPane.INFORMATION_MESSAGE);
                openDashboard(user);
            } catch (Exception ex) {
                JOptionPane.showMessageDialog(this, ex.getMessage(), "提示", JOptionPane.WARNING_MESSAGE);
            }
        });

        panel.add(form, BorderLayout.CENTER);
        return panel;
    }

    private void openDashboard(User user) {
        DashboardFrame frame = new DashboardFrame(user);
        frame.setVisible(true);
        dispose();
    }
}
