import { StatusBar } from "expo-status-bar";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native";
import DraftCameraScreen from "./src/screens/DraftCameraScreen";

export default function App() {
  return (
    <GestureHandlerRootView style={StyleSheet.absoluteFill}>
      <StatusBar style="light" />
      <DraftCameraScreen />
    </GestureHandlerRootView>
  );
}
