import React, { useState, useEffect, useRef } from 'react';
import {
    Alert,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
    FlatList,
    TextInput,
    ScrollView,
    useWindowDimensions,
    SafeAreaView,
    StatusBar,
    Modal
} from 'react-native';
import { Animated } from 'react-native';
import * as Location from 'expo-location';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, updateDoc } from 'firebase/firestore'; // (if you're using these)
import MapView, { Polygon, Polyline } from 'react-native-maps';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth'; // Already in firebase.js but used here
import { Linking } from 'react-native';
import { writeBatch } from 'firebase/firestore';
import AuthScreen from './AuthScreen';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { setDoc } from 'firebase/firestore';

// ✅ FIX 1: Import firebase config BEFORE using any Firebase services
// ✅ FIX 2: Make sure the filename matches your actual file

const DEFAULT_USERNAME = "guestUser";

// Working on getting this from a backend
const generateGuestID = () => "guest" + Math.floor(10000 + Math.random() * 90000);
function generateUniqueColor(seedString) {
    let hash = 0;
    for (let i = 0; i < seedString.length; i++) {
        hash = seedString.charCodeAt(i) + ((hash << 5) - hash);
    }

    const h = Math.abs(hash) % 360;
    const s = 65 + (Math.abs(hash) % 20);  // 65–85%
    const l = 55 + (Math.abs(hash) % 10);  // 55–65%

    return `hsl(${h}, ${s}%, ${l}%)`;
}

function hslToRgba(hslStr) {
    const result = /hsl\((\d+),(\d+)%?,\s*(\d+)%?\)/.exec(hslStr);
    if (!result) return 'rgba(0,0,0,0.3)';
    const h = parseInt(result[1], 10);
    const s = parseInt(result[2], 10) / 100;
    const l = parseInt(result[3], 10) / 100;

    const a = s * Math.min(l, 1 - l);
    const f = n => {
        const k = (n + h / 30) % 12;
        const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
        return Math.round(255 * color);
    };
    return `rgba(${f(0)},${f(8)},${f(4)},0.4)`; // You can tweak alpha here
}

function MainScreen() {
    console.log("=== APP COMPONENT MOUNTING ===");  // Debug 1
    // State variables
    const uniqueColor = generateUniqueColor(DEFAULT_USERNAME);

    const [user, setUser] = useState({
        id: DEFAULT_USERNAME,
        displayName: "Player1",
        score: 0,
        color: uniqueColor
    });
    console.log("Initial user state:", user);  // Debug 2
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [currentPosition, setCurrentPosition] = useState(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordedPath, setRecordedPath] = useState([]);
    const [territories, setTerritories] = useState([]);
    const [showProfileModal, setShowProfileModal] = useState(false);
    useEffect(() => {
        if (profileSavedBanner) {
            const timeout = setTimeout(() => setProfileSavedBanner(false), 3000);
            return () => clearTimeout(timeout);
        }
    }, [profileSavedBanner]);
    const [profileSavedBanner, setProfileSavedBanner] = useState(false);
    const bannerOpacity = useRef(new Animated.Value(0)).current;
    const onProfileSaved = () => {
        setProfileSavedBanner(true);
        Animated.timing(bannerOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
        }).start(() => {
            setTimeout(() => {
                Animated.timing(bannerOpacity, {
                    toValue: 0,
                    duration: 300,
                    useNativeDriver: true,
                }).start(() => {
                    setProfileSavedBanner(false);
                });
            }, 3000);
        });
    };
    const [showLeaderboard, setShowLeaderboard] = useState(false);
    const [leaderboardData, setLeaderboardData] = useState([]);
    useEffect(() => {
        const q = query(collection(db, 'users'), orderBy('score', 'desc'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const data = snapshot.docs
                .map(doc => ({
                    id: doc.id,
                    ...doc.data()
                }))
                .filter(user =>
                    user.id !== DEFAULT_USERNAME &&
                    !user.displayName?.toLowerCase().includes("test") &&
                    !user.id.toLowerCase().includes("dev") &&
                    !user.id.toLowerCase().includes("@example.com")
                )
            setLeaderboardData(data);
        });

        return () => unsubscribe(); // 🔄 Clean up listener
    }, []);
    const [territoryFilter, setTerritoryFilter] = useState("all"); // "all" or "mine"
    const filteredTerritories = territoryFilter === "mine"
        ? territories.filter(t => t.owner === user.id)
        : territories;
    const [locationPermission, setLocationPermission] = useState(null);
    const [region, setRegion] = useState({
        latitude: 43.6150,
        longitude: -116.2023,
        latitudeDelta: 0.0122,
        longitudeDelta: 0.0121,
    });
    const [captureStatus, setCaptureStatus] = useState('');

    // Reference for map
    const mapRef = useRef(null);

    // Get device dimensions
    const {width: screenWidth, height: screenHeight} = useWindowDimensions();
    const isLandscape = screenWidth > screenHeight;

    // Location tracking interval
    const locationInterval = useRef(null);

    const previousScoreRef = useRef(user?.score);

    // Load initial data when component mounts
    useEffect(() => {
        const authUnsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
            if (firebaseUser) {
                const uid = firebaseUser.uid;
                const displayName = firebaseUser.displayName || 'Anonymous';
                const color = generateUniqueColor(uid);
                const userData = { id: uid, displayName, color, score: 0 };

                setUser(userData);
                setIsAuthenticated(true);
                loadSavedData(uid); // Pass UID directly instead of relying on state
            } else {
                setIsAuthenticated(false);
                const fallbackId = DEFAULT_USERNAME;
                const fallbackColor = generateUniqueColor(fallbackId);
                setUser({
                    id: fallbackId,
                    displayName: "Player1",
                    score: 0,
                    color: fallbackColor
                });
            }
        });

        return () => {
            authUnsubscribe();
            if (locationInterval.current) {
                clearInterval(locationInterval.current);
            }
        };
    }, []);

// Handle score updates
    useEffect(() => {
        if (!isAuthenticated || !user?.id) return;
        if (user.score === previousScoreRef.current) return;

        const saveScore = async () => {
            const uid = user?.id;
            if (!uid) return; // ✅ Guard just in case

            try {
                await setDoc(doc(db, 'users', uid), {
                    score: user.score,
                    lastUpdated: new Date().toISOString()
                }, { merge: true });

                previousScoreRef.current = user.score;
            } catch (error) {
                console.error("Firestore update failed:", error);
            }
        };

        saveScore();
    }, [user?.score, isAuthenticated]);

    // Request location permission
    const requestLocationPermission = async () => {
        try {
            const { status, canAskAgain } = await Location.requestForegroundPermissionsAsync();
            setLocationPermission(status);

            if (status !== 'granted') {
                Alert.alert(
                    "Permission Required",
                    canAskAgain
                        ? "Location access is needed for territory capture. Please enable it in settings."
                        : "Open app settings to enable location permissions",
                    [
                        { text: "Cancel" },
                        { text: "Settings", onPress: () => Linking.openSettings() }
                    ]
                );
            } else {
                updateCurrentPosition();
            }
        } catch (error) {
            console.error("Permission error:", error);
        }
    };

    // Update current position
    const updateCurrentPosition = async () => {
        try {
            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High
            });

            const {latitude, longitude} = location.coords;
            setCurrentPosition({latitude, longitude});

            // Move map to current location initially
            if (mapRef.current && !isRecording) {
                mapRef.current.animateToRegion({
                    latitude,
                    longitude,
                    latitudeDelta: 0.005,
                    longitudeDelta: 0.005
                });
            }

        } catch (error) {
            console.error("Error getting current location:", error);
        }
    };

    // Start territory capture
    const startCapture = async () => {
        // ✅ [NEW] Prevent double-start if already recording
        if (isRecording || locationInterval.current) {
            Alert.alert("Already Recording", "Territory capture is already in progress.");
            return;
        }

        // ✅ [UNCHANGED] Check for permission
        if (locationPermission !== 'granted') {
            Alert.alert("Permission Required", "Location permission is needed to capture territory.");
            return;
        }

        // ✅ [UNCHANGED] Reset path and state
        setRecordedPath([]);
        setIsRecording(true);

        locationInterval.current = setInterval(async () => {
            // Early exit if recording stopped
            if (!locationInterval.current) return;

            try {
                const location = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced, // Better battery than High
                    timeInterval: 5000, // iOS-only optimization
                    distanceInterval: 5, // Minimum meters between updates
                    mayShowUserSettingsDialog: true // Allow user to fix settings
                });

                const {latitude, longitude} = location.coords;
                const newPoint = {latitude, longitude};

                setCurrentPosition(newPoint);

                setRecordedPath(prevPath => {
                    if (!isRecording || !prevPath) return prevPath || [];

                    if (prevPath.length === 0) {
                        setCaptureStatus(`Capturing... 1 point`);
                        return [newPoint];
                    }

                    const lastPoint = prevPath[prevPath.length - 1];
                    const distance = haversineDistance(lastPoint, newPoint);

                    if (distance >= 5) {
                        const newPath = [...prevPath, newPoint];
                        setCaptureStatus(`Capturing... ${newPath.length} points`);
                        return newPath;
                    }

                    return prevPath;
                });

            } catch (error) {
                console.error("Location error:", error);

                // Handle specific error cases
                if (error.code === 'ERR_CANCELLED') {
                    // Permission revoked during capture
                    Alert.alert(
                        "Location Access Lost",
                        "Please re-enable location permissions to continue capturing",
                        [{text: "OK", onPress: () => stopCapture()}]
                    );
                } else if (error.code === 'ERR_NOT_ENABLED') {
                    Alert.alert(
                        "Location Disabled",
                        "Turn on device location services to continue",
                        [{text: "OK"}]
                    );
                }
            }
        }, 5000); // Reduced from 2000ms to 5000ms (2s → 5s)

// Visual feedback
        Alert.alert(
            "Territory Capture Started",
            "Walk at normal speed to create your territory boundary.",
            [
                {
                    text: "Stop Recording",
                    onPress: () => stopCapture(),
                    style: "destructive"
                },
                {
                    text: "Continue",
                    style: "cancel"
                }
            ]
        );
    };

    const validatePolygon = (vertices) => {
        if (vertices.length < 3) return false;
        const first = vertices[0];
        const last = vertices[vertices.length - 1];
        return (
            Math.abs(first.latitude - last.latitude) < 0.0001 &&
            Math.abs(first.longitude - last.longitude) < 0.0001
        );
    };

    // Stop territory capture
    const stopCapture = async () => {
        // Stop tracking interval
        if (locationInterval.current) {
            clearInterval(locationInterval.current);
            locationInterval.current = null;
        }

        setIsRecording(false);

        // Take a snapshot of recordedPath to avoid race conditions
        const currentPath = [...recordedPath];

// Check if we have enough points
        if (currentPath.length < 3) {
            Alert.alert(
                "Capture Failed",
                "Not enough points to create a territory. Need at least 3 points."
            );
            return;
        }

        let finalPath = [...currentPath];

// Safe access now that we’ve confirmed length >= 3
        const startPoint = currentPath[0];
        const endPoint = currentPath[currentPath.length - 1];

        if (!validatePolygon(currentPath)) {
            currentPath.push(currentPath[0]); // force close
        }

        // Calculate area of the polygon
        const area = calculatePolygonArea(finalPath);
        const areaInSquareMeters = Math.abs(area);
        const points = Math.floor(areaInSquareMeters / 100); // 1 point per 100 sq meters

        // Create new territory
        const newTerritory = {
            id: Date.now().toString(),
            name: `Territory ${territories.length + 1}`,
            path: finalPath,
            owner: user.id,
            ownerName: user.displayName,
            color: user.color,
            area: areaInSquareMeters,
            points: points,
            captureDate: new Date().toISOString()
        };

        // Add territory and update user score
        const newScore = user.score + points;
        const updatedTerritories = [...territories, newTerritory];
        const userTerritories = updatedTerritories.filter(t => t.owner === user.id);  // ✅ Move this up

        setTerritories(updatedTerritories);
        setUser(prev => ({
            ...prev,
            score: newScore
        }));

// ✅ Save updated score and territory count to Firestore
        if (!user?.id) return;
        await setDoc(doc(db, 'users', updatedUser.id), {
            score: newScore,
            territories: userTerritories.length
        }, { merge: true });

// Update leaderboard
        updateLeaderboard(points);

// Save data
        saveData();

        Alert.alert(
            "Territory Captured!",
            `You've claimed ${areaInSquareMeters.toFixed(0)} sq meters worth ${points} points!`
        );

    };

    // Calculate polygon area
    const calculatePolygonArea = (vertices) => {
        if (vertices.length < 3) return 0;

        const toRadians = deg => (deg * Math.PI) / 180;
        const earthRadius = 6378137; // in meters (WGS-84)

        let area = 0;
        for (let i = 0; i < vertices.length; i++) {
            const { latitude: lat1, longitude: lon1 } = vertices[i];
            const { latitude: lat2, longitude: lon2 } = vertices[(i + 1) % vertices.length];

            area += toRadians(lon2 - lon1) *
                (2 + Math.sin(toRadians(lat1)) + Math.sin(toRadians(lat2)));
        }

        area = area * earthRadius * earthRadius / 2.0;
        return Math.abs(area); // in square meters
    };

    // Calculate distance between two lat/lng points in meters
    const haversineDistance = (point1, point2) => {
        const R = 6371000; // Earth radius in meters
        const toRad = deg => (deg * Math.PI) / 180;

        const dLat = toRad(point2.latitude - point1.latitude);
        const dLon = toRad(point2.longitude - point1.longitude);

        const lat1 = toRad(point1.latitude);
        const lat2 = toRad(point2.latitude);

        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

        return R * c;
    };


    // Update leaderboard with new points
    const updateLeaderboard = (points) => {
        setLeaderboardData(prev => {
            // Find user in leaderboard
            const updatedLeaderboard = prev.map(player => {
                if (player.id === user.id) {
                    return {
                        ...player,
                        score: player.score + points,
                        territories: player.territories + 1
                    };
                }
                return player;
            });

            // Sort by score
            return updatedLeaderboard.sort((a, b) => b.score - a.score);
        });
    };

    const saveGameData = async () => {
        if (!user?.id) return;
        const batch = writeBatch(db);
        batch.update(doc(db, 'users', user.id), {
            score: user.score,
            lastUpdated: new Date().toISOString(),
        });

        territories.forEach((territory) => {
            batch.set(doc(db, 'territories', territory.id), territory);
        });

        await batch.commit();
    };

    // Save data to storage
    const saveData = async (updatedUser = user, updatedTerritories = territories, updatedLeaderboard = leaderboardData) => {
        try {
            const data = {
                user: updatedUser,
                territories: updatedTerritories,
                leaderboard: updatedLeaderboard
            };

            // Save locally
            await AsyncStorage.setItem('geoconquest_data', JSON.stringify(data));
            console.log("Data saved locally");

            // Save to server
            await fetch(`https://mec402.boisestate.edu/csclasses/cs402/project/savejson.php?user=${encodeURIComponent(data.user.id)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            console.log("Data saved to server");
        } catch (error) {
            console.error("Error saving data:", error);
        }
    };

    // Load saved data from storage
    const loadSavedData = async () => {
        try {
            // 1. Try to load current user's data from server
            let currentUserData = null;

            try {
                const response = await fetch(
                    `https://mec402.boisestate.edu/csclasses/cs402/project/loadjson.php?user=${user.id}`
                );
                const text = await response.text();

                if (!response.ok || !text || text.includes("Unable to open file!")) {
                    console.warn("⚠️ No server file found. Creating a default file...");

                    const defaultData = {
                        user: {
                            id: user.id,
                            name: user.name || "New User"
                        },
                        territories: [],
                        profile: {},
                    };

                    // Create the default file on the server
                    await fetch(
                        `https://mec402.boisestate.edu/csclasses/cs402/project/savejson.php?user=${encodeURIComponent(user.id)}`,
                        {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(defaultData),
                        }
                    );

                    console.log("✅ Default user file created for:", user.id);
                    currentUserData = defaultData;
                } else {
                    try {
                        currentUserData = JSON.parse(text);
                    } catch (err) {
                        console.error("❌ Failed to parse server data:", err, "Raw text:", text);
                        throw new Error("Invalid JSON from server.");
                    }
                }
            } catch (serverError) {
                console.warn("⚠️ Failed to load from server:", serverError);

                // Fall back to local storage
                try {
                    const localData = await AsyncStorage.getItem('geoconquest_data');
                    if (localData) {
                        currentUserData = JSON.parse(localData);
                        console.log("✅ Loaded data from local storage");
                    } else {
                        console.warn("⚠️ No local data found");
                    }
                } catch (localError) {
                    console.error("❌ Failed to load local data:", localError);
                }
            }

            // ✅ Now use currentUserData safely
            if (currentUserData?.territories?.length > 0) {
                setTerritories(currentUserData.territories);
            }
        } catch (err) {
            console.error("❌ loadSavedData failed:", err);
        }
    };

    // Check if a point is inside a territory
    const isPointInPolygon = (point, polygon) => {
        let isInside = false;
        const x = point.longitude;
        const y = point.latitude;

        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const xi = polygon[i].longitude;
            const yi = polygon[i].latitude;
            const xj = polygon[j].longitude;
            const yj = polygon[j].latitude;

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

            if (intersect) isInside = !isInside;
        }

        return isInside;
    };

    // Attack a territory
    const attackTerritory = async (territory) => {
        if (!currentPosition) {
            Alert.alert("Error", "Your current position is unknown.");
            return;
        }

        // Check if player is inside the territory
        if (!isPointInPolygon(currentPosition, territory.path)) {
            Alert.alert(
                "Cannot Attack",
                "You must be physically inside a territory to challenge it."
            );
            return;
        }

        // Simulate a 50/50 chance of success
        const success = Math.random() > 0.5;

        if (success) {
            // Capture the territory
            setTerritories(prev =>
                prev.map(t => {
                    if (t.id === territory.id) {
                        return {
                            ...t,
                            owner: user.id,
                            ownerName: user.displayName,
                            color: user.color
                        };
                    }
                    return t;
                })
            );
            await updateDoc(doc(db, 'territories', territory.id), {
                owner: user.id,
                ownerName: user.displayName,
                color: user.color,
                captureDate: new Date().toISOString()
            });

            // Transfer territory points to attacker
            const updatedLeaderboard = leaderboardData.map(entry => {
                if (entry.id === user.id) {
                    return { ...entry, score: entry.score + territory.points, territoryCount: (entry.territoryCount || 0) + 1 };
                } else if (entry.id === territory.owner) {
                    return { ...entry, score: Math.max(0, entry.score - territory.points), territoryCount: Math.max(0, (entry.territoryCount || 1) - 1) };
                } else {
                    return entry;
                }
            });
            setLeaderboardData(updatedLeaderboard);
            saveData(user, territories, updatedLeaderboard);

            Alert.alert(
                "Victory!",
                `You've successfully captured ${territory.name} from ${territory.ownerName}!`
            );
        } else {
            Alert.alert(
                "Attack Failed",
                "Your challenge was unsuccessful. Try again later!"
            );
        }
    };

    // Component for territory item in the list
    const TerritoryItem = ({item}) => {
        console.log("Rendering territory item:", item.id);  // Debug 23
        // Calculate how long ago the territory was captured
        const getTimeAgo = (dateString) => {
            const captureDate = new Date(dateString);
            const now = new Date();
            const diffInSeconds = Math.floor((now - captureDate) / 1000);

            if (diffInSeconds < 60) return `${diffInSeconds}s ago`;

            const diffInMinutes = Math.floor(diffInSeconds / 60);
            if (diffInMinutes < 60) return `${diffInMinutes}m ago`;

            const diffInHours = Math.floor(diffInMinutes / 60);
            if (diffInHours < 24) return `${diffInHours}h ago`;

            const diffInDays = Math.floor(diffInHours / 24);
            if (diffInDays < 30) return `${diffInDays}d ago`;

            return captureDate.toLocaleDateString();
        };

        // Format area to a readable format
        const formatArea = (areaSqMeters) => {
            if (areaSqMeters < 1000) {
                return `${areaSqMeters.toFixed(0)} m²`;
            } else {
                return `${(areaSqMeters / 1000).toFixed(1)} km²`;
            }
        };

        return (
            <TouchableOpacity
                style={styles.territoryItem}
                onPress={() => {
                    console.log("Pressed territory:", item.name);  // Debug 24
                    // Center map on this territory
                    const center = findCenterOfPolygon(item.path);
                    moveToLocation(center.latitude, center.longitude, 0.005);
                }}
                onLongPress={() => {
                    // If it's not the user's territory, offer to attack it
                    if (item.owner !== user.id) {
                        Alert.alert(
                            "Challenge Territory",
                            `Do you want to try to capture ${item.name} from ${item.ownerName}?`,
                            [
                                {text: "Cancel", style: "cancel"},
                                {
                                    text: "Attack!",
                                    style: "destructive",
                                    onPress: async () => await attackTerritory(item)
                                }
                            ]
                        );
                    } else {
                        // If it's the user's territory, show options (rename, etc)
                        Alert.alert(
                            "Manage Territory",
                            `What would you like to do with ${item.name}?`,
                            [
                                {text: "Cancel", style: "cancel"},
                                {
                                    text: "Rename",
                                    onPress: () => {
                                        // Implement territory renaming functionality
                                        Alert.alert("Coming soon", "Renaming will be available in the next update!");
                                    }
                                }
                            ]
                        );
                    }
                }}
            >
                <View style={[styles.territoryColorBadge, {backgroundColor: item.color}]}/>

                <View style={styles.territoryItemContent}>
                    <View style={styles.territoryItemHeader}>
                        <Text style={styles.territoryItemName}>{item.name}</Text>
                        <View style={styles.territoryPointsContainer}>
                            <Text style={styles.territoryItemPoints}>{item.points}</Text>
                        </View>
                    </View>

                    <View style={styles.territoryItemRow}>
                        <View style={styles.territoryOwnerSection}>
                            <FontAwesome
                                name={item.owner === user.id ? "user" : "user-o"}
                                size={12}
                                color={item.owner === user.id ? "#2ecc71" : "#7f8c8d"}
                            />
                            <Text style={[styles.territoryItemOwner, item.owner === user.id ? styles.ownTerritoryText : {}]}>
                                {item.owner === user.id ? "You" : (item.ownerName || "Unknown")}
                            </Text>
                        </View>

                        <View style={styles.territoryDetailsSection}>
                            <FontAwesome name="map-o" size={12} color="#7f8c8d"/>
                            <Text style={styles.territoryItemDetails}>
                                {formatArea(item.area)}
                            </Text>
                        </View>
                    </View>

                    <View style={styles.territoryCaptureInfo}>
                        <FontAwesome name="clock-o" size={12} color="#7f8c8d"/>
                        <Text style={styles.territoryCaptureTime}>
                            {getTimeAgo(item.captureDate)}
                        </Text>
                    </View>
                </View>
            </TouchableOpacity>
        );
    };

    const MemoizedTerritoryItem = React.memo(
        ({ item, onPress, onLongPress }) => (
            <TerritoryItem
                item={item}
                onPress={onPress}
                onLongPress={onLongPress}
            />
        ),
        (prev, next) => (
            prev.item.id === next.item.id &&
            prev.item.owner === next.item.owner && // Check if ownership changed
            prev.item.name === next.item.name      // Check if name changed
        )
    );

    // Find center of polygon for map focusing
    const findCenterOfPolygon = (points) => {
        let sumLat = 0;
        let sumLng = 0;

        points.forEach(point => {
            sumLat += point.latitude;
            sumLng += point.longitude;
        });

        return {
            latitude: sumLat / points.length,
            longitude: sumLng / points.length
        };
    };

    // Move map to a specific location with custom zoom
    const moveToLocation = (latitude, longitude, delta = 0.01) => {
        if (mapRef.current) {
            mapRef.current.animateToRegion({
                latitude,
                longitude,
                latitudeDelta: delta,
                longitudeDelta: delta
            });
        }
    };

    const LeaderboardModal = () => {
        console.log("=== LEADERBOARD MODAL RENDERING ===");  // Debug 22
        return (
            <Modal
                visible={showLeaderboard}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowLeaderboard(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowLeaderboard(false)}
                >
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={e => e.stopPropagation()}
                        style={[styles.modalContent, styles.leaderboardModal]}
                    >
                        <View style={styles.modalHeader}>
                            <View style={styles.leaderboardHeaderContent}>
                                <FontAwesome name="trophy" size={24} color="#f1c40f" />
                                <Text style={styles.modalTitle}>Leaderboard</Text>
                            </View>
                            <TouchableOpacity
                                style={styles.closeButton}
                                onPress={() => setShowLeaderboard(false)}
                            >
                                <FontAwesome name="close" size={20} color="#fff" />
                            </TouchableOpacity>
                        </View>

                        <View style={styles.leaderboardHeaderRow}>
                            <Text style={styles.leaderboardHeaderText}>Rank</Text>
                            <Text style={[styles.leaderboardHeaderText, { flex: 1 }]}>Player</Text>
                            <Text style={styles.leaderboardHeaderText}>Score</Text>
                        </View>

                        <FlatList
                            data={leaderboardData}
                            keyExtractor={(item) => item.id}
                            showsVerticalScrollIndicator={false}
                            renderItem={({ item, index }) => (
                                <View style={[
                                    styles.leaderboardItem,
                                    item.id === user.id ? styles.currentUserItem : null,
                                ]}>
                                    <View style={styles.rankBadge}>
                                        {index < 3 ? (
                                            <FontAwesome name="star" size={12} color="#fff" />
                                        ) : (
                                            <Text style={styles.leaderboardRank}>{index + 1}</Text>
                                        )}
                                    </View>

                                    <View style={styles.leaderboardUserInfo}>
                                        <Text style={styles.leaderboardUsername}>{item.displayName || "Player"}</Text>
                                        <Text style={styles.leaderboardDetails}>
                                            {item.territories} {item.territories === 1 ? 'territory' : 'territories'}
                                        </Text>
                                    </View>

                                    <View style={styles.scoreContainer}>
                                        <Text style={styles.scoreValue}>{item.score}</Text>
                                        <Text style={styles.scoreLabel}>pts</Text>
                                    </View>
                                </View>
                            )}
                        />
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>
        );
    };

    // Profile modal component
    const ProfileModal = ({ onProfileSaved }) => {
        console.log("=== PROFILE MODAL RENDERING ===");  // Debug 21
        // Local state for form inputs to prevent modal from closing
        const [displayName, setDisplayName] = useState("");
        useEffect(() => {
            setDisplayName(user.displayName || "");
        }, [user]);
        const userRankIndex = leaderboardData.findIndex(p => p.id === user.id);
        const [saveError, setSaveError] = useState(null);
        const handleLogout = async () => {
            await AsyncStorage.removeItem('geoconquest_data');
            setIsAuthenticated(false);
            setUser({
                id: DEFAULT_USERNAME,
                displayName: "Player1",
                score: 0,
                color: generateUniqueColor(DEFAULT_USERNAME)
            });
            setTerritories([]);
            setLeaderboardData([]);
        };
        const [isSaving, setIsSaving] = useState(false);
        // Save changes function
        const saveChanges = async () => {
            if (isSaving) return; // prevent double save
            setIsSaving(true);
            if (user.displayName === displayName) {
                console.log("🛑 No changes to save");
                setIsSaving(false);
                return;
            }
            try {
                console.log("🚀 Save button clicked");

                const updatedUser = {
                    ...user,
                    displayName: displayName
                };
                if (!updatedUser?.id) return;
                console.log("📦 Updated user object created");

                const updatedLeaderboard = leaderboardData.map(player =>
                    player.id === user.id
                        ? { ...player, displayName: displayName }
                        : player
                );
                console.log("🏆 Leaderboard updated");

                const updatedTerritories = territories.map(t =>
                    t.owner === user.id
                        ? { ...t, ownerName: displayName }
                        : t
                );
                console.log("🌍 Territories updated");
                console.log("📍 Setting user state:", updatedUser);
                setTimeout(() => {
                    setUser(updatedUser);
                }, 100);
                setLeaderboardData(updatedLeaderboard);
                console.log("📍 Leaderboard state set:", updatedLeaderboard);
                setTerritories(updatedTerritories);
                console.log("📍 Territories state set:", updatedTerritories);
                console.log("✅ Local states set");
                console.log("📍 Closing profile modal");
                setShowProfileModal(false);

                // Utility function to enforce a timeout
                const firestoreTimeout = (promise, timeout = 5000) =>
                    Promise.race([
                        promise,
                        new Promise((_, reject) =>
                            setTimeout(() => reject(new Error('🔥 Firestore update timed out')), timeout)
                        )
                    ]);

                try {
                    console.log("⏳ Attempting Firestore update");
                        await firestoreTimeout(
                            setDoc(doc(db, 'users', updatedUser.id), {
                                displayName: displayName
                            }, {merge: true}),
                            5000
                        );
                    console.log("✅ Firestore update succeeded");
                } catch (err) {
                    console.error("❌ Firestore update failed or timed out:", err);
                    Alert.alert("Firestore Error", err.message);
                }

                await saveData(updatedUser, updatedTerritories, updatedLeaderboard);
                onProfileSaved?.(); // safely call it if passed
                console.log("💾 Local + remote data saved");

                console.log("✅ Modal closed after save");

            } catch (error) {
                console.error("❌ Error during profile save:", error);
                setSaveError("Could not save your changes. Please try again.");
            }
            setIsSaving(false);
        };

        return (
            <Modal
                visible={showProfileModal}
                transparent={true}
                animationType="slide"
                onRequestClose={() => setShowProfileModal(false)}
            >
                <TouchableOpacity
                    style={styles.modalOverlay}
                    activeOpacity={1}
                    onPress={() => setShowProfileModal(false)}
                >
                    <TouchableOpacity
                        activeOpacity={1}
                        onPress={e => e.stopPropagation()}
                        style={styles.modalContent}
                    >
                        <View style={styles.modalHeader}>
                            <Text style={styles.modalTitle}>Your Profile</Text>
                            <TouchableOpacity onPress={() => setShowProfileModal(false)}>
                                <FontAwesome name="close" size={24} color="#333"/>
                            </TouchableOpacity>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false}>
                            <View style={styles.profileAvatar}>
                                <View style={styles.avatarCircle}>
                                    <Text style={styles.avatarText}>
                                        {(displayName || "P").charAt(0).toUpperCase()}
                                    </Text>
                                </View>
                            </View>

                            <View style={styles.profileStats}>
                                <View style={styles.profileStatItem}>
                                    <Text style={styles.profileStatValue}>{user.score}</Text>
                                    <Text style={styles.profileStatLabel}>Total Points</Text>
                                </View>
                                <View style={styles.profileStatItem}>
                                    <Text style={styles.profileStatValue}>
                                        {territories.filter(t => t.owner === user.id).length}
                                    </Text>
                                    <Text style={styles.profileStatLabel}>Territories</Text>
                                </View>
                                <View style={styles.profileStatItem}>
                                    <Text style={styles.profileStatValue}>
                                        {userRankIndex >= 0 ? userRankIndex + 1 : 'N/A'}
                                    </Text>
                                    <Text style={styles.profileStatLabel}>Rank</Text>
                                </View>
                            </View>

                            <View style={styles.formSection}>
                                <Text style={styles.settingsLabel}>Display Name</Text>
                                <TextInput
                                    style={styles.displayNameInput}
                                    value={displayName}
                                    onChangeText={(text) => {
                                        setDisplayName(text);
                                        setSaveError(null); // ✅ Clear error message when user types
                                    }}
                                    placeholder="Enter your display name"
                                    maxLength={15}
                                />
                            </View>

                            <View style={styles.formSection}>
                                <Text style={styles.settingsLabel}>Assigned Territory Color</Text>
                                <View style={styles.colorPreviewContainer}>
                                    <View style={[styles.colorPreviewBox, { backgroundColor: user.color }]} />
                                    <Text style={styles.colorHexText}>{user.color.toUpperCase()}</Text>
                                </View>
                                <Text style={{ fontSize: 12, color: '#888', marginTop: 5 }}>
                                    This color is assigned automatically and cannot be changed.
                                </Text>
                            </View>

                            {/*<View style={styles.formSection}>*/}
                            {/*  <Text style={styles.settingsLabel}>Territory Color</Text>*/}
                            {/*  <View style={styles.colorPicker}>*/}
                            {/*    {["#4a90e2", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#34495e", "#1abc9c"].map(color => (*/}
                            {/*      <TouchableOpacity*/}
                            {/*        key={color}*/}
                            {/*        style={[*/}
                            {/*          styles.colorOption,*/}
                            {/*          { backgroundColor: color },*/}
                            {/*          selectedColor === color && styles.selectedColorOption*/}
                            {/*        ]}*/}
                            {/*        onPress={() => setSelectedColor(color)}*/}
                            {/*      />*/}
                            {/*    ))}*/}
                            {/*  </View>*/}
                            {/*</View>*/}

                            {saveError && (
                                <View style={{ backgroundColor: '#ffe6e6', padding: 10, borderRadius: 5, marginBottom: 10 }}>
                                    <Text style={{ color: '#c0392b', fontWeight: 'bold' }}>{saveError}</Text>
                                </View>
                            )}

                            <TouchableOpacity
                                onPress={saveChanges}
                                disabled={isSaving}
                                style={[
                                    styles.saveButton, // use your green button style
                                    isSaving && styles.disabledButton
                                ]}
                            >
                                <Text style={styles.saveButtonText}>
                                    {isSaving ? 'Saving...' : 'Save Changes'}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                style={[styles.saveButton, { backgroundColor: '#e74c3c', marginTop: 10 }]}
                                onPress={handleLogout}
                            >
                                <Text style={styles.saveButtonText}>Log Out</Text>
                            </TouchableOpacity>
                        </ScrollView>
                    </TouchableOpacity>
                </TouchableOpacity>
            </Modal>
        );
    };
// Avoid unnecessary re-renders when map region changes
    const handleRegionChange = (newRegion) => {
        if (JSON.stringify(region) !== JSON.stringify(newRegion)) {
            setRegion(newRegion);
        }
    };

    // Render main app
    // Render main app
    return (
        <SafeAreaView style={styles.container}>

            <StatusBar barStyle="dark-content"/>

            {isAuthenticated ? (
                <View style={styles.container}>
                    {profileSavedBanner && (
                        <Animated.View style={{
                            position: 'absolute',
                            top: 60,
                            alignSelf: 'center',
                            backgroundColor: '#2ecc71',
                            paddingVertical: 8,
                            paddingHorizontal: 15,
                            borderRadius: 10,
                            zIndex: 100,
                            elevation: 10,
                            opacity: bannerOpacity
                        }}>
                            <Text style={{ color: 'white', fontWeight: 'bold' }}>✅ Profile saved!</Text>
                        </Animated.View>
                    )}
                    {/* Map View */}
                    <MapView
                        ref={mapRef}
                        style={styles.map}
                        initialRegion={region}
                        onRegionChangeComplete={handleRegionChange}
                        showsUserLocation={true}
                        followsUserLocation={isRecording}
                        loadingEnabled={true}
                        loadingIndicatorColor="#666666"
                        loadingBackgroundColor="#eeeeee"
                    >
                    {/* Territory Polygons */}
                        {territories.map((territory) => (
                            <Polygon
                                key={territory.id}
                                coordinates={territory.path}
                                strokeColor={territory.color}
                                fillColor={hslToRgba(territory.color)}
                                strokeWidth={2}
                            />
                        ))}

                        {/* Current Path Tracking */}
                        {isRecording && recordedPath.length > 1 && (
                            <Polyline coordinates={recordedPath} strokeColor={user.color} strokeWidth={3} />
                        )}
                    </MapView>

                    {/* All other UI parts: header, capture button, territory list, modals */}
                    {/* Header Controls */}
                    <View style={styles.headerControls}>
                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => setShowProfileModal(true)}
                        >
                            <View style={styles.buttonInner}>
                                <FontAwesome name="user" size={20} color="#fff" />
                            </View>
                        </TouchableOpacity>

                        <View style={styles.scoreDisplay}>
                            <View style={styles.scoreIcon}>
                                <FontAwesome name="star" size={16} color="#f1c40f" />
                            </View>
                            <Text style={styles.scoreText}>{user.score}</Text>
                        </View>

                        <TouchableOpacity
                            style={styles.controlButton}
                            onPress={() => setShowLeaderboard(true)}
                        >
                            <View style={styles.buttonInner}>
                                <FontAwesome name="trophy" size={20} color="#fff" />
                            </View>
                        </TouchableOpacity>
                    </View>
                    {isRecording && (
                        <View style={styles.recordingStatus}>
                            <View style={styles.recordingDot} />
                            <Text style={styles.recordingText}>{captureStatus}</Text>
                        </View>
                    )}
                    {/* Capture Button */}
                    <View style={styles.captureContainer}>
                        {!isRecording ? (
                            <TouchableOpacity style={styles.captureButton} onPress={startCapture}>
                                <View style={styles.captureButtonInner}>
                                    <FontAwesome name="map-marker" size={28} color="white" />
                                </View>
                                <Text style={styles.captureButtonText}>Start Capturing</Text>
                            </TouchableOpacity>
                        ) : (
                            <TouchableOpacity style={[styles.captureButton, styles.stopButton]} onPress={stopCapture}>
                                <View style={styles.captureButtonInner}>
                                    <FontAwesome name="stop-circle" size={28} color="white" />
                                </View>
                                <Text style={styles.captureButtonText}>Finish Territory</Text>
                            </TouchableOpacity>
                        )}

                        {/*
                {isRecording && recordedPath.length > 0 && (
                    <View style={styles.captureStats}>
                      <Text style={styles.captureStatsText}>
                        {`Points: ${Math.floor(calculatePolygonArea(recordedPath) / 100)} • Vertices: ${recordedPath.length}`}
                      </Text>
                    </View>
                )}
                */}
                    </View>

                    {/* Territory List */}
                    {/* Territory List */}
                    <View style={styles.territoryListContainer}>
                        <View style={styles.territoryListHeader}>
                            <Text style={styles.territoryListTitle}>Territories</Text>
                            <View style={styles.territoryFilter}>
                                <TouchableOpacity
                                    style={territoryFilter === "all" ? styles.filterButtonActive : styles.filterButton}
                                    onPress={() => setTerritoryFilter("all")}
                                >
                                    <Text style={territoryFilter === "all" ? styles.filterButtonActiveText : styles.filterButtonText}>
                                        All
                                    </Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    style={territoryFilter === "mine" ? styles.filterButtonActive : styles.filterButton}
                                    onPress={() => setTerritoryFilter("mine")}
                                >
                                    <Text style={territoryFilter === "mine" ? styles.filterButtonActiveText : styles.filterButtonText}>
                                        Mine
                                    </Text>
                                </TouchableOpacity>
                            </View>
                        </View>

                        {territories.length === 0 ? (
                            <View style={styles.emptyTerritoriesContainer}>
                                <FontAwesome name="map-o" size={36} color="#ccc" />
                                <Text style={styles.emptyTerritoriesText}>No territories captured yet.</Text>
                                <Text style={styles.emptyTerritoriesSubtext}>Start by capturing an area!</Text>
                            </View>
                        ) : (
                            <FlatList
                                data={filteredTerritories}
                                renderItem={({ item }) => (
                                    <MemoizedTerritoryItem
                                        item={item}
                                        onPress={() => {
                                            const center = findCenterOfPolygon(item.path);
                                            moveToLocation(center.latitude, center.longitude, 0.005);
                                        }}
                                    />
                                )}
                                initialNumToRender={3}
                                maxToRenderPerBatch={5}
                                windowSize={5}
                            />
                        )}
                    </View> {/* ✅ Close territory list container here */}

                    <LeaderboardModal/>
                    <ProfileModal onProfileSaved={onProfileSaved} />
                </View>
            ) : (
                <AuthScreen />
            )}
        </SafeAreaView>
    );
}

// Create styles
const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f8f9fa',
    },
    map: {
        ...StyleSheet.absoluteFillObject,
    },
    // Header controls
    headerControls: {
        position: 'absolute',
        top: 10,
        left: 10,
        right: 10,
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        zIndex: 10,
    },
    controlButton: {
        width: 45,
        height: 45,
        borderRadius: 22.5,
        backgroundColor: 'rgba(52, 73, 94, 0.9)',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
    },
    buttonInner: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    scoreDisplay: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(52, 73, 94, 0.9)',
        paddingVertical: 8,
        paddingHorizontal: 15,
        borderRadius: 20,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.3,
        shadowRadius: 3,
    },
    scoreIcon: {
        marginRight: 5,
    },
    scoreText: {
        fontSize: 16,
        fontWeight: 'bold',
        color: 'white',
    },
    // Accuracy indicator
    accuracyContainer: {
        position: 'absolute',
        top: 65,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 5,
    },
    accuracyIndicator: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 15,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 1.5,
    },
    accuracyText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#333',
        marginLeft: 5,
    },
    // Capture controls
    captureContainer: {
        position: 'absolute',
        bottom: 170,
        left: 0,
        right: 0,
        alignItems: 'center',
    },
    captureButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(46, 204, 113, 0.9)',
        paddingVertical: 12,
        paddingHorizontal: 25,
        borderRadius: 30,
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 3 },
        shadowOpacity: 0.3,
        shadowRadius: 4,
    },
    captureButtonInner: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: 'rgba(255, 255, 255, 0.2)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    stopButton: {
        backgroundColor: 'rgba(231, 76, 60, 0.9)',
    },
    captureButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    captureStats: {
        backgroundColor: 'rgba(255, 255, 255, 0.9)',
        paddingVertical: 6,
        paddingHorizontal: 15,
        borderRadius: 15,
        marginTop: 10,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 1.5,
    },
    captureStatsText: {
        fontSize: 12,
        color: '#333',
    },
    // Territory list
    territoryListContainer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: 'white',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingVertical: 15,
        elevation: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -3 },
        shadowOpacity: 0.3,
        shadowRadius: 5,
        height: 150,
    },
    territoryListHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingHorizontal: 20,
        marginBottom: 15,
    },
    territoryListTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#333',
    },
    territoryFilter: {
        flexDirection: 'row',
        backgroundColor: '#f1f2f6',
        borderRadius: 15,
        padding: 3,
    },
    filterButton: {
        paddingVertical: 5,
        paddingHorizontal: 12,
        borderRadius: 12,
    },
    filterButtonText: {
        fontSize: 12,
        color: '#7f8c8d',
    },
    filterButtonActive: {
        fontSize: 12,
        color: '#fff',
        fontWeight: 'bold',
        backgroundColor: '#3498db',
        overflow: 'hidden',
        borderRadius: 12,
        paddingVertical: 5,
        paddingHorizontal: 12,
    },
    filterButtonActiveText: {
        fontSize: 12,
        color: '#fff',
        fontWeight: 'bold',
    },
    territoryList: {
        paddingHorizontal: 15,
    },
    emptyTerritoriesContainer: {
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 20,
    },
    emptyTerritoriesText: {
        fontSize: 16,
        color: '#95a5a6',
        marginTop: 10,
        marginBottom: 5,
    },
    emptyTerritoriesSubtext: {
        fontSize: 14,
        color: '#bdc3c7',
    },
    territoryItem: {
        flexDirection: 'row',
        backgroundColor: 'white',
        borderRadius: 12,
        marginHorizontal: 5,
        width: 220,
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
        overflow: 'hidden',
    },
    territoryColorBadge: {
        width: 8,
        height: '100%',
    },
    territoryItemContent: {
        flex: 1,
        padding: 12,
    },
    territoryItemHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
    },
    territoryItemName: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#333',
        flex: 1,
    },
    territoryPointsContainer: {
        backgroundColor: '#f1f9f7',
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 10,
        marginLeft: 5,
    },
    territoryItemPoints: {
        fontSize: 12,
        fontWeight: 'bold',
        color: '#2ecc71',
    },
    territoryItemRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    territoryOwnerSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    territoryItemOwner: {
        fontSize: 13,
        color: '#7f8c8d',
        marginLeft: 4,
    },
    ownTerritoryText: {
        color: '#2ecc71',
        fontWeight: '600',
    },
    territoryDetailsSection: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    territoryItemDetails: {
        fontSize: 12,
        color: '#7f8c8d',
        marginLeft: 4,
    },
    territoryCaptureInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 4,
    },
    territoryCaptureTime: {
        fontSize: 11,
        color: '#95a5a6',
        marginLeft: 4,
    },
    // Modals
    modalOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    modalContent: {
        backgroundColor: 'white',
        borderRadius: 20,
        padding: 20,
        width: '85%',
        maxHeight: '70%',
        elevation: 5,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 3.84,
    },
    leaderboardModal: {
        backgroundColor: '#34495e',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 20,
        paddingBottom: 15,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
    },
    leaderboardHeaderContent: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    modalTitle: {
        fontSize: 22,
        fontWeight: 'bold',
        color: 'white',
        marginLeft: 10,
    },
    closeButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: 'rgba(255,255,255,0.2)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    // Leaderboard styles
    leaderboardHeaderRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 15,
        paddingVertical: 10,
        marginBottom: 5,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.1)',
    },
    leaderboardHeaderText: {
        fontSize: 12,
        fontWeight: 'bold',
        color: 'rgba(255,255,255,0.7)',
        textTransform: 'uppercase',
        letterSpacing: 1,
    },
    leaderboardItem: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingVertical: 12,
        paddingHorizontal: 15,
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(255,255,255,0.05)',
    },
    currentUserItem: {
        backgroundColor: 'rgba(46, 204, 113, 0.15)',
        borderRadius: 8,
    },
    rankBadge: {
        width: 28,
        height: 28,
        borderRadius: 14,
        backgroundColor: 'rgba(255,255,255,0.1)',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    firstPlace: {
        backgroundColor: '#f1c40f',
    },
    secondPlace: {
        backgroundColor: '#bdc3c7',
    },
    thirdPlace: {
        backgroundColor: '#cd6133',
    },
    leaderboardRank: {
        fontSize: 12,
        fontWeight: 'bold',
        color: 'white',
    },
    leaderboardUserInfo: {
        flex: 1,
    },
    leaderboardUsername: {
        fontSize: 16,
        fontWeight: 'bold',
        color: 'white',
        marginBottom: 3,
    },
    leaderboardDetails: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.7)',
    },
    scoreContainer: {
        alignItems: 'flex-end',
    },
    scoreValue: {
        fontSize: 18,
        fontWeight: 'bold',
        color: 'white',
    },
    scoreLabel: {
        fontSize: 10,
        color: 'rgba(255,255,255,0.5)',
        marginTop: 2,
    },
    // Profile styles
    profileAvatar: {
        alignItems: 'center',
        marginBottom: 20,
    },
    avatarCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#3498db',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 3,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 2,
    },
    avatarText: {
        fontSize: 40,
        fontWeight: 'bold',
        color: 'white',
    },
    profileStats: {
        flexDirection: 'row',
        justifyContent: 'space-around',
        backgroundColor: '#f8f9fa',
        borderRadius: 12,
        padding: 15,
        marginBottom: 20,
    },
    profileStatItem: {
        alignItems: 'center',
    },
    profileStatValue: {
        fontSize: 24,
        fontWeight: 'bold',
        color: '#333',
    },
    profileStatLabel: {
        fontSize: 12,
        color: '#7f8c8d',
        marginTop: 5,
    },
    formSection: {
        marginBottom: 20,
    },
    settingsLabel: {
        fontSize: 16,
        fontWeight: 'bold',
        color: '#555',
        marginBottom: 10,
    },
    displayNameInput: {
        borderWidth: 1,
        borderColor: '#ddd',
        borderRadius: 8,
        backgroundColor: '#f9f9f9',
        padding: 12,
        fontSize: 16,
    },
    colorPicker: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        flexWrap: 'wrap',
    },
    colorOption: {
        width: 40,
        height: 40,
        borderRadius: 20,
        margin: 5,
    },
    selectedColorOption: {
        borderWidth: 3,
        borderColor: '#333',
        transform: [{ scale: 1.1 }],
    },
    saveButton: {
        backgroundColor: '#2ecc71',
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
        marginTop: 10,
    },
    saveButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: 'bold',
    },
    disabledButton: {
        opacity: 0.5,
    },
    // 👇 Paste this block here
    colorPreviewContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 5,
    },
    colorPreviewBox: {
        width: 30,
        height: 30,
        borderRadius: 15,
        marginRight: 10,
        borderWidth: 1,
        borderColor: '#ccc',
    },
    colorHexText: {
        fontSize: 16,
        color: '#333',
    },
    authContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 20,
        backgroundColor: '#f5f6fa',
    },
    authTitle: {
        fontSize: 24,
        fontWeight: 'bold',
        marginBottom: 20,
    },
    authInput: {
        width: '100%',
        borderWidth: 1,
        borderColor: '#ccc',
        borderRadius: 8,
        padding: 12,
        marginBottom: 15,
        backgroundColor: '#fff',
    },
    authButton: {
        backgroundColor: '#2ecc71',
        paddingVertical: 12,
        paddingHorizontal: 24,
        borderRadius: 8,
    },
    authButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: 'bold',
    },
    recordingStatus: {
        position: 'absolute',
        top: 70,
        alignSelf: 'center',
        backgroundColor: 'rgba(255,255,255,0.9)',
        paddingVertical: 5,
        paddingHorizontal: 15,
        borderRadius: 20,
        flexDirection: 'row',
        alignItems: 'center',
        elevation: 3,
        zIndex: 12,
    },
    recordingDot: {
        width: 10,
        height: 10,
        borderRadius: 5,
        backgroundColor: 'red',
        marginRight: 8,
    },
    recordingText: {
        fontSize: 12,
        fontWeight: '500',
        color: '#e74c3c',
    },
});

export default MainScreen;