package app.util;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

public class FileUtils {
    private static final int BUFFER_SIZE = 8192;

    public static void copyFile(File source, File target) throws IOException {
        if (source == null || target == null) {
            throw new IOException("文件为空");
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        try (FileInputStream inputStream = new FileInputStream(source);
             FileOutputStream outputStream = new FileOutputStream(target)) {
            byte[] buffer = new byte[BUFFER_SIZE];
            int read;
            while ((read = inputStream.read(buffer)) != -1) {
                outputStream.write(buffer, 0, read);
            }
        }
    }

    public static String readText(File source) throws IOException {
        if (source == null || !source.exists()) {
            throw new IOException("文件不存在");
        }
        try (FileInputStream inputStream = new FileInputStream(source)) {
            ByteArrayOutputStream buffer = new ByteArrayOutputStream();
            byte[] data = new byte[BUFFER_SIZE];
            int read;
            while ((read = inputStream.read(data)) != -1) {
                buffer.write(data, 0, read);
            }
            return new String(buffer.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    public static void writeText(File target, String content) throws IOException {
        if (target == null) {
            throw new IOException("文件为空");
        }
        File parent = target.getParentFile();
        if (parent != null && !parent.exists()) {
            parent.mkdirs();
        }
        try (FileOutputStream outputStream = new FileOutputStream(target)) {
            byte[] data = content == null ? new byte[0] : content.getBytes(StandardCharsets.UTF_8);
            outputStream.write(data);
        }
    }
}
