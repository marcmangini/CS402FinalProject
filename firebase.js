import { initializeApp } from 'firebase/app';
import { Platform } from 'react-native';
import {
    initializeAuth,
    getReactNativePersistence,
    browserLocalPersistence,
    getAuth
} from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
    apiKey: "AIzaSyAIbFFj5glIJ42fe59ZK8T0lpnO1qmTOGI",
    authDomain: "geocaptureapp.firebaseapp.com",
    projectId: "geocaptureapp",
    storageBucket: "geocaptureapp.appspot.com",
    messagingSenderId: "285519594548",
    appId: "1:285519594548:web:35be4169ccc71e3bc17661"
};

const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth with persistence
let auth;
if (Platform.OS === 'web') {
    auth = getAuth(app); // browserLocalPersistence is handled automatically
} else {
    auth = initializeAuth(app, {
        persistence: getReactNativePersistence(ReactNativeAsyncStorage),
    });
}

const db = getFirestore(app);

// ✅ Safe exports – ONLY after everything above runs
export { auth, db };
