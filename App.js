import 'react-native-get-random-values'; // <-- Required by Firebase Auth
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MainScreen from './MainScreen';
import AuthScreen from './AuthScreen';
import { auth } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { ActivityIndicator, View, Text } from 'react-native';
import * as Network from 'expo-network';

const Stack = createNativeStackNavigator();

class ErrorBoundary extends React.Component {
    state = { hasError: false };

    static getDerivedStateFromError(error) {
        return { hasError: true };
    }

    componentDidCatch(error, errorInfo) {
        console.error("[APP CRASH]", error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                    <Text>Something went wrong. Restart the app.</Text>
                </View>
            );
        }
        return this.props.children;
    }
}

export default function App() {
    const [initializing, setInitializing] = React.useState(true);
    const [user, setUser] = React.useState(null);

    useEffect(() => {
        console.log("[DEBUG] Auth state listener setup");
        console.log("[App] Firebase Auth is:", auth);
        const subscriber = onAuthStateChanged(auth, (user) => {
            console.log(`[AUTH] User state: ${user ? "Logged in ("+user.email+")" : "Logged out"}`);
            setUser(user);
            if (initializing) {
                console.log("[AUTH] Initialization complete");
                setInitializing(false);
            }
        }, (error) => {
            console.error("[AUTH ERROR]", error); // Add error callback
        });
        return () => {
            console.log("[DEBUG] Cleaning up auth listener");
            subscriber();
        }; // Unsubscribe on unmount
    }, []);

    useEffect(() => {
        const checkNetwork = async () => {
            const { isConnected } = await Network.getNetworkStateAsync();
            if (!isConnected) {
                Alert.alert("Offline", "Some features may not work without internet");
            }
        };
        const timeout = setTimeout(checkNetwork, 500); // Delay to avoid alert spam during load
        return () => clearTimeout(timeout);
    }, []);

    if (initializing) {
        return (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <ActivityIndicator size="large" />
            </View>
        );
    }

    return (
        <ErrorBoundary>
            <NavigationContainer>
                <Stack.Navigator
                    initialRouteName={user ? "Main" : "Auth"}
                    screenOptions={{ headerShown: false }}
                >
                    <Stack.Screen name="Auth" component={AuthScreen} />
                    <Stack.Screen name="Main" component={MainScreen} />
                </Stack.Navigator>
            </NavigationContainer>
        </ErrorBoundary>
    );
}