import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyAIbFFj5glIJ42fe59ZK8T0lpnO1qmTOGI",
    authDomain: "geocaptureapp.firebaseapp.com",
    projectId: "geocaptureapp",
    storageBucket: "geocaptureapp.appspot.com",
    messagingSenderId: "285519594548",
    appId: "1:285519594548:web:35be4169ccc71e3bc17661"
};

const app = initializeApp(firebaseConfig);

const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
});

const db = getFirestore(app);

export { auth, db };
