import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, serverTimestamp, doc, deleteDoc } from 'firebase/firestore';
import {
  AppBar, Toolbar, Typography, Button, Container, Box, TextField, List, ListItem,
  ListItemText, ListItemSecondaryAction, IconButton, Paper, CircularProgress, Alert
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import LogoutIcon from '@mui/icons-material/Logout';

// Context for Firebase services and user information
const FirebaseContext = createContext(null);

// Firebase Provider component to initialize Firebase and manage auth state
const FirebaseProvider = ({ children }) => {
  const [app, setApp] = useState(null);
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    try {
      // Retrieve Firebase config and app ID from global variables
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-angi-app-id';
      const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
      const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

      // Initialize Firebase app
      const firebaseApp = initializeApp(firebaseConfig);
      setApp(firebaseApp);

      // Initialize Firestore and Auth
      const firestoreDb = getFirestore(firebaseApp);
      setDb(firestoreDb);
      const firebaseAuth = getAuth(firebaseApp);
      setAuth(firebaseAuth);

      // Authenticate user
      const signInUser = async () => {
        try {
          if (initialAuthToken) {
            await signInWithCustomToken(firebaseAuth, initialAuthToken);
          } else {
            await signInAnonymously(firebaseAuth);
          }
        } catch (e) {
          console.error("Firebase authentication error:", e);
          setError("Failed to authenticate with Firebase.");
        } finally {
          setLoading(false);
        }
      };

      // Listen for auth state changes
      const unsubscribe = onAuthStateChanged(firebaseAuth, (user) => {
        if (user) {
          setUserId(user.uid);
        } else {
          setUserId(null);
          // If no user, try to sign in
          if (!loading) signInUser(); // Only try to sign in if not already in the process
        }
        setLoading(false);
      });

      // Initial sign-in attempt if no user is found immediately
      if (!firebaseAuth.currentUser) {
        signInUser();
      }

      return () => unsubscribe(); // Cleanup auth listener
    } catch (e) {
      console.error("Firebase initialization error:", e);
      setError("Failed to initialize Firebase. Please check the configuration.");
      setLoading(false);
    }
  }, []); // Empty dependency array ensures this runs once on mount

  const handleSignOut = async () => {
    if (auth) {
      try {
        await signOut(auth);
        setUserId(null); // Clear userId on sign out
        // Re-authenticate anonymously after sign out
        await signInAnonymously(auth);
      } catch (e) {
        console.error("Error signing out:", e);
        setError("Failed to sign out.");
      }
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
        <Typography variant="h6" sx={{ ml: 2 }}>Loading Firebase...</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    );
  }

  return (
    <FirebaseContext.Provider value={{ app, db, auth, userId, handleSignOut }}>
      {children}
    </FirebaseContext.Provider>
  );
};

// Main App component
const App = () => {
  return (
    <FirebaseProvider>
      <AngiCloneAppContent />
    </FirebaseProvider>
  );
};

const AngiCloneAppContent = () => {
  const { db, userId, handleSignOut } = useContext(FirebaseContext);
  const [services, setServices] = useState([]);
  const [newService, setNewService] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [submitLoading, setSubmitLoading] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  useEffect(() => {
    if (!db || !userId) return;

    // Define collection paths for public and private data
    const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-angi-app-id';
    const publicServicesCollectionRef = collection(db, `artifacts/${appId}/public/data/services`);
    // const privateServicesCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/services`); // Example for private data

    // Listen to public services collection for real-time updates
    const q = query(publicServicesCollectionRef); // No orderBy to avoid index issues
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const servicesData = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Sort services in memory by timestamp if needed, as orderBy is avoided
      servicesData.sort((a, b) => (b.timestamp?.toDate() || 0) - (a.timestamp?.toDate() || 0));
      setServices(servicesData);
    }, (error) => {
      console.error("Error fetching services:", error);
      setSubmitError("Failed to load services.");
    });

    return () => unsubscribe(); // Cleanup listener on unmount or userId/db change
  }, [db, userId]);

  const handleAddService = async () => {
    if (!db || !userId || !newService.trim()) {
      setSubmitError("Service name cannot be empty.");
      return;
    }
    setSubmitLoading(true);
    setSubmitError(null);

    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-angi-app-id';
      const publicServicesCollectionRef = collection(db, `artifacts/${appId}/public/data/services`);

      await addDoc(publicServicesCollectionRef, {
        name: newService.trim(),
        description: newDescription.trim(),
        userId: userId, // Store the user who added the service
        timestamp: serverTimestamp(), // Add a server timestamp
      });
      setNewService('');
      setNewDescription('');
    } catch (e) {
      console.error("Error adding service:", e);
      setSubmitError("Failed to add service. Please try again.");
    } finally {
      setSubmitLoading(false);
    }
  };

  const handleDeleteService = async (serviceId) => {
    if (!db || !userId) return;

    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-angi-app-id';
      const serviceDocRef = doc(db, `artifacts/${appId}/public/data/services`, serviceId);
      await deleteDoc(serviceDocRef);
    } catch (e) {
      console.error("Error deleting service:", e);
      setSubmitError("Failed to delete service. Please try again.");
    }
  };

  return (
    <Box sx={{ flexGrow: 1, backgroundColor: '#f5f5f5', minHeight: '100vh', fontFamily: 'Inter, sans-serif' }}>
      <AppBar position="static" sx={{ backgroundColor: '#1976d2', borderRadius: '8px', margin: '8px' }}>
        <Toolbar>
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
            Angi Clone
          </Typography>
          {userId && (
            <Typography variant="subtitle1" sx={{ mr: 2, color: 'rgba(255,255,255,0.8)' }}>
              User ID: {userId}
            </Typography>
          )}
          <Button color="inherit" onClick={handleSignOut} startIcon={<LogoutIcon />}>
            Sign Out
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="md" sx={{ mt: 4, mb: 4 }}>
        <Paper elevation={3} sx={{ p: 3, borderRadius: '12px', mb: 4, backgroundColor: '#fff' }}>
          <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', color: '#333' }}>
            Add a New Service
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <TextField
              label="Service Name (e.g., Plumbing, Electrical)"
              variant="outlined"
              fullWidth
              value={newService}
              onChange={(e) => setNewService(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
            />
            <TextField
              label="Service Description"
              variant="outlined"
              fullWidth
              multiline
              rows={3}
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
            />
            <Button
              variant="contained"
              color="primary"
              onClick={handleAddService}
              disabled={submitLoading}
              startIcon={<AddCircleOutlineIcon />}
              sx={{
                borderRadius: '8px',
                padding: '12px 24px',
                fontWeight: 'bold',
                boxShadow: '0 4px 8px rgba(0,0,0,0.1)',
                '&:hover': {
                  boxShadow: '0 6px 12px rgba(0,0,0,0.15)',
                },
              }}
            >
              {submitLoading ? <CircularProgress size={24} color="inherit" /> : 'Add Service'}
            </Button>
            {submitError && <Alert severity="error" sx={{ mt: 2, borderRadius: '8px' }}>{submitError}</Alert>}
          </Box>
        </Paper>

        <Paper elevation={3} sx={{ p: 3, borderRadius: '12px', backgroundColor: '#fff' }}>
          <Typography variant="h5" gutterBottom sx={{ fontWeight: 'bold', color: '#333' }}>
            Available Services
          </Typography>
          {services.length === 0 ? (
            <Typography variant="body1" color="textSecondary" sx={{ mt: 2 }}>
              No services added yet. Add one above!
            </Typography>
          ) : (
            <List>
              {services.map((service) => (
                <ListItem
                  key={service.id}
                  divider
                  sx={{
                    borderRadius: '8px',
                    mb: 1,
                    backgroundColor: '#f9f9f9',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    '&:hover': {
                      backgroundColor: '#f0f0f0',
                    },
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography variant="h6" sx={{ fontWeight: 'bold', color: '#555' }}>
                        {service.name}
                      </Typography>
                    }
                    secondary={
                      <>
                        <Typography variant="body2" color="textSecondary">
                          {service.description || 'No description provided.'}
                        </Typography>
                        <Typography variant="caption" color="textSecondary" sx={{ display: 'block', mt: 0.5 }}>
                          Added by: {service.userId}
                          {service.timestamp && ` on ${new Date(service.timestamp.toDate()).toLocaleString()}`}
                        </Typography>
                      </>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton edge="end" aria-label="delete" onClick={() => handleDeleteService(service.id)}>
                      <DeleteIcon color="error" />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </Container>
    </Box>
  );
};

export default App;
