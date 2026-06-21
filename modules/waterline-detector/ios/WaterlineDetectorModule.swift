import ExpoModulesCore

public class WaterlineDetectorModule: Module {
    public func definition() -> ModuleDefinition {
        Name("WaterlineDetector")
        // No JS API — the frame processor plugin is the sole interface.
    }
}
