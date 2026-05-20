package app;

import app.service.DataStore;
import app.service.SubmissionService;
import app.service.SubmissionServiceImpl;
import app.service.UserService;
import app.service.UserServiceImpl;

public class AppContext {
    private static final DataStore DATA_STORE = new DataStore();
    private static final UserService USER_SERVICE = new UserServiceImpl(DATA_STORE);
    private static final SubmissionService SUBMISSION_SERVICE = new SubmissionServiceImpl(DATA_STORE);

    public static DataStore getDataStore() {
        return DATA_STORE;
    }

    public static UserService getUserService() {
        return USER_SERVICE;
    }

    public static SubmissionService getSubmissionService() {
        return SUBMISSION_SERVICE;
    }
}
