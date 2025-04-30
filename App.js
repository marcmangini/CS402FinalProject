import React, { useState, useEffect, useRef } from 'react';
import { 
  Alert, 
  Button, 
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
import MapView, { Marker, Polygon } from 'react-native-maps';
import * as Location from 'expo-location';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Working on getting this from a backend
const DEFAULT_USERNAME = "guest" + Math.floor(Math.random() * 10000);

export default function App() {
  // State variables
  const [user, setUser] = useState({
    id: DEFAULT_USERNAME,
    displayName: "Player1",
    score: 0,
    color: "#4a90e2"
  });
  const [currentPosition, setCurrentPosition] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedPath, setRecordedPath] = useState([]);
  const [territories, setTerritories] = useState([]);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [leaderboardData, setLeaderboardData] = useState([
    { id: "player1", displayName: "GeoMaster", score: 1250, territories: 5 },
    { id: "player2", displayName: "WalkingKing", score: 980, territories: 3 },
    { id: DEFAULT_USERNAME, displayName: "Player1", score: 450, territories: 2 },
    { id: "player3", displayName: "AreaHunter", score: 420, territories: 1 }
  ]);
  const [locationPermission, setLocationPermission] = useState(null);
  const [region, setRegion] = useState({
    latitude: 43.6150,  
    longitude: -116.2023,
    latitudeDelta: 0.0122,
    longitudeDelta: 0.0121,
  });
  
  // Reference for map
  const mapRef = useRef(null);
  
  // Get device dimensions
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const isLandscape = screenWidth > screenHeight;

  // Location tracking interval
  const locationInterval = useRef(null);

  // Load initial data when component mounts
  useEffect(() => {
    // Request location permissions and load saved data
    requestLocationPermission();
    loadSavedData();
    
    return () => {
      // Clean up location tracking on unmount
      if (locationInterval.current) {
        clearInterval(locationInterval.current);
      }
    };
  }, []);

  // Request location permission
  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setLocationPermission(status === 'granted' ? 'granted' : 'denied');
      
      if (status === 'granted') {
        // Start tracking current position
        updateCurrentPosition();
      }
    } catch (error) {
      console.error("Error requesting location permission:", error);
      setLocationPermission('error');
    }
  };

  // Update current position
  const updateCurrentPosition = async () => {
    try {
      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High
      });
      
      const { latitude, longitude } = location.coords;
      setCurrentPosition({ latitude, longitude });
      
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
    if (locationPermission !== 'granted') {
      Alert.alert("Permission Required", "Location permission is needed to capture territory.");
      return;
    }
    
    // Reset path
    setRecordedPath([]);
    setIsRecording(true);
    
    // Start tracking location at regular intervals
    locationInterval.current = setInterval(async () => {
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High
        });
        
        const { latitude, longitude } = location.coords;
        setCurrentPosition({ latitude, longitude });
        
        // Add point to path if recording
        setRecordedPath(prevPath => [...prevPath, { latitude, longitude }]);
        
      } catch (error) {
        console.error("Error tracking location:", error);
      }
    }, 2000); // Update every 2 seconds - adjust based on testing
    
    Alert.alert(
      "Territory Capture Started", 
      "Walk around the area you want to claim. The app will track your path."
    );
  };

  // Stop territory capture
  const stopCapture = () => {
    // Stop tracking interval
    if (locationInterval.current) {
      clearInterval(locationInterval.current);
      locationInterval.current = null;
    }
    
    setIsRecording(false);
    
    // Check if we have enough points for a territory
    if (recordedPath.length < 3) {
      Alert.alert(
        "Capture Failed", 
        "Not enough points to create a territory. Need at least 3 points."
      );
      return;
    }
    
    // Close the loop if needed
    let finalPath = [...recordedPath];
    
    // If the end point is not close to the start point, add the start point to close the polygon
    const startPoint = recordedPath[0];
    const endPoint = recordedPath[recordedPath.length - 1];

    // If the end point is not close enough to the start point, close the polygon
    if (
        startPoint.latitude !== endPoint.latitude ||
        startPoint.longitude !== endPoint.longitude
    ) {
      finalPath.push(startPoint);
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
    setTerritories(prev => [...prev, newTerritory]);
    setUser(prev => ({
      ...prev,
      score: prev.score + points
    }));
    
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
    // Convert lat/long to meters using  approximation
    // This is a simplified calculation and not perfect for large areas
    const earthRadius = 6371000; // meters
    
    const metersVertices = vertices.map(point => {
      const latRad = (point.latitude * Math.PI) / 180;
      const lngRad = (point.longitude * Math.PI) / 180;
      
      // Simple approximation - not accurate for large distances
      const x = earthRadius * lngRad * Math.cos(latRad);
      const y = earthRadius * latRad;
      
      return { x, y };
    });
    
    let area = 0;
    for (let i = 0, j = metersVertices.length - 1; i < metersVertices.length; j = i++) {
      area += (metersVertices[j].x + metersVertices[i].x) * 
              (metersVertices[j].y - metersVertices[i].y);
    }
    
    return area / 2;
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

  // Save data to storage
  const saveData = async () => {
    try {
      const data = {
        user,
        territories,
        leaderboard: leaderboardData
      };

      // Save locally
      await AsyncStorage.setItem('geoconquest_data', JSON.stringify(data));
      console.log("Data saved locally");

      // Save to server using professor's URL
      await fetch(`https://mec402.boisestate.edu/csclasses/cs402/project/savejson.php?user=${user.id}`, {
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
      // Try loading from server first
      const response = await fetch(`https://mec402.boisestate.edu/csclasses/cs402/project/loadjson.php?user=${user.id}`);
      const text = await response.text();

      try {
        const cloudData = JSON.parse(text);

        if (cloudData) {
          setUser(cloudData.user || user);
          setTerritories(cloudData.territories || []);
          setLeaderboardData(cloudData.leaderboard || leaderboardData);
          console.log("Loaded data from server.");
        }
      } catch (err) {
        console.error("Server response is not valid JSON:", text);
      }

      // Also attempt to load local backup
      const savedData = await AsyncStorage.getItem('geoconquest_data');
      if (savedData) {
        const parsedData = JSON.parse(savedData);
        setUser(parsedData.user || user);
        setTerritories(parsedData.territories || []);
        setLeaderboardData(parsedData.leaderboard || leaderboardData);
        console.log("Loaded local backup.");
      }
    } catch (error) {
      console.error("Error loading saved or server data:", error);
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
  const attackTerritory = (territory) => {
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
    
    saveData();
  };

  // Component for territory item in the list
  const TerritoryItem = ({ item }) => {
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
                { text: "Cancel", style: "cancel" },
                { 
                  text: "Attack!", 
                  style: "destructive",
                  onPress: () => attackTerritory(item) 
                }
              ]
            );
          } else {
            // If it's the user's territory, show options (rename, etc)
            Alert.alert(
              "Manage Territory",
              `What would you like to do with ${item.name}?`,
              [
                { text: "Cancel", style: "cancel" },
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
        <View style={[styles.territoryColorBadge, { backgroundColor: item.color }]} />
        
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
              <Text 
                style={[
                  styles.territoryItemOwner,
                  item.owner === user.id ? styles.ownTerritoryText : {}
                ]}
              >
                {item.owner === user.id ? "You" : item.ownerName}
              </Text>
            </View>
            
            <View style={styles.territoryDetailsSection}>
              <FontAwesome name="map-o" size={12} color="#7f8c8d" />
              <Text style={styles.territoryItemDetails}>
                {formatArea(item.area)}
              </Text>
            </View>
          </View>
          
          <View style={styles.territoryCaptureInfo}>
            <FontAwesome name="clock-o" size={12} color="#7f8c8d" />
            <Text style={styles.territoryCaptureTime}>
              {getTimeAgo(item.captureDate)}
            </Text>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

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

  // Leaderboard modal component
  const LeaderboardModal = () => (
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
                <View style={[
                  styles.rankBadge,
                  index === 0 ? styles.firstPlace : 
                  index === 1 ? styles.secondPlace :
                  index === 2 ? styles.thirdPlace : null
                ]}>
                  <Text style={styles.leaderboardRank}>
                    {index < 3 ? 
                      <FontAwesome 
                        name="star" 
                        size={12} 
                        color="#fff" 
                      /> : 
                      `${index + 1}`
                    }
                  </Text>
                </View>
                
                <View style={styles.leaderboardUserInfo}>
                  <Text style={styles.leaderboardUsername}>{item.displayName}</Text>
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

  // Profile modal component
  const ProfileModal = () => {
    // Local state for form inputs to prevent modal from closing
    const [displayName, setDisplayName] = useState(user.displayName);
    const [id, setId] = useState(user.id);
    const [selectedColor, setSelectedColor] = useState(user.color);
    
    // Save changes function
    const saveChanges = () => {
      setUser(prev => ({
        ...prev,
        displayName: displayName,
        color: selectedColor
      }));
      saveData();
      setShowProfileModal(false);
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
                <FontAwesome name="close" size={24} color="#333" />
              </TouchableOpacity>
            </View>
            
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={styles.profileAvatar}>
                <View style={styles.avatarCircle}>
                  <Text style={styles.avatarText}>{displayName.charAt(0).toUpperCase()}</Text>
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
                    {leaderboardData.findIndex(p => p.id === user.id) + 1}
                  </Text>
                  <Text style={styles.profileStatLabel}>Rank</Text>
                </View>
              </View>
              
              <View style={styles.formSection}>
                <Text style={styles.settingsLabel}>Display Name</Text>
                <TextInput
                  style={styles.displayNameInput}
                  value={displayName}
                  onChangeText={setDisplayName}
                  placeholder="Enter your display name"
                  maxLength={15}
                />
              </View>
              
              <View style={styles.formSection}>
                <Text style={styles.settingsLabel}>Territory Color</Text>
                <View style={styles.colorPicker}>
                  {["#4a90e2", "#e74c3c", "#2ecc71", "#f39c12", "#9b59b6", "#34495e", "#1abc9c"].map(color => (
                    <TouchableOpacity
                      key={color}
                      style={[
                        styles.colorOption,
                        { backgroundColor: color },
                        selectedColor === color && styles.selectedColorOption
                      ]}
                      onPress={() => setSelectedColor(color)}
                    />
                  ))}
                </View>
              </View>
              
              <TouchableOpacity 
                style={styles.saveButton}
                onPress={saveChanges}
              >
                <Text style={styles.saveButtonText}>Save Changes</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    );
  };

  // Render main app
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />
      
      <View style={styles.container}>
        {/* Map View */}
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={region}
          onRegionChangeComplete={setRegion}
          showsUserLocation={true}
          followsUserLocation={isRecording}
        >
          {/* Territory Polygons */}
          {territories.map((territory) => (
            <Polygon
              key={territory.id}
              coordinates={territory.path}
              strokeColor={territory.color}
              fillColor={`${territory.color}80`} // 50% transparency
              strokeWidth={2}
            />
          ))}
          
          {/* Current Path Tracking */}
          {isRecording && recordedPath.length > 1 && (
            <Polygon
              coordinates={recordedPath}
              strokeColor={user.color}
              fillColor={`${user.color}40`} // 25% transparency
              strokeWidth={2}
            />
          )}
        </MapView>
        
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
        
        {/* Location accuracy indicator */}
        {currentPosition && (
          <View style={styles.accuracyContainer}>
            <View style={styles.accuracyIndicator}>
              <FontAwesome 
                name="location-arrow" 
                size={14} 
                color={isRecording ? "#e74c3c" : "#2ecc71"} 
              />
              <Text style={styles.accuracyText}>
                {isRecording ? "Recording Path" : "GPS Ready"}
              </Text>
            </View>
          </View>
        )}

        {/* Capture Button */}
        <View style={styles.captureContainer}>
          {!isRecording ? (
            <TouchableOpacity 
              style={styles.captureButton}
              onPress={startCapture}
            >
              <View style={styles.captureButtonInner}>
                <FontAwesome name="map-marker" size={28} color="white" />
              </View>
              <Text style={styles.captureButtonText}>Start Capturing</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity 
              style={[styles.captureButton, styles.stopButton]}
              onPress={stopCapture}
            >
              <View style={styles.captureButtonInner}>
                <FontAwesome name="stop-circle" size={28} color="white" />
              </View>
              <Text style={styles.captureButtonText}>Finish Territory</Text>
            </TouchableOpacity>
          )}
          
          {isRecording && recordedPath.length > 0 && (
            <View style={styles.captureStats}>
              <Text style={styles.captureStatsText}>
                Points: {Math.floor(calculatePolygonArea(recordedPath) / 100)} • 
                Vertices: {recordedPath.length}
              </Text>
            </View>
          )}
        </View>
        
        {/* Territory List Partial View */}
        <View style={styles.territoryListContainer}>
          <View style={styles.territoryListHeader}>
            <Text style={styles.territoryListTitle}>Territories</Text>
            <View style={styles.territoryFilter}>
              <TouchableOpacity style={styles.filterButton}>
                <Text style={styles.filterButtonActive}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.filterButton}>
                <Text style={styles.filterButtonText}>Mine</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          {territories.length === 0 ? (
            <View style={styles.emptyTerritoriesContainer}>
              <FontAwesome name="map-o" size={36} color="#ccc" />
              <Text style={styles.emptyTerritoriesText}>
                No territories captured yet.
              </Text>
              <Text style={styles.emptyTerritoriesSubtext}>
                Start by capturing an area!
              </Text>
            </View>
          ) : (
            <FlatList
              data={territories}
              renderItem={({ item }) => <TerritoryItem item={item} />}
              keyExtractor={(item) => item.id}
              horizontal={true}
              showsHorizontalScrollIndicator={false}
              style={styles.territoryList}
            />
          )}
        </View>
        
        {/* Modals */}
        <LeaderboardModal />
        <ProfileModal />
      </View>
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
});