import Accelerate
import CoreVideo
import VisionCamera

@objc(WaterlineDetectorPlugin)
public class WaterlineDetectorPlugin: FrameProcessorPlugin {
    public override init(proxy: VisionCameraProxyHolder, options: [AnyHashable: Any]! = [:]) {
        super.init(proxy: proxy, options: options)
    }

    public override func callback(_ frame: Frame, withArguments arguments: [AnyHashable: Any]?) -> Any? {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(frame.buffer) else { return nil }

        CVPixelBufferLockBaseAddress(imageBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(imageBuffer, .readOnly) }

        // Work on luma (Y) plane of YUV420 — no colour conversion, fastest access
        guard CVPixelBufferGetPlaneCount(imageBuffer) >= 1 else { return nil }

        let fullWidth  = CVPixelBufferGetWidthOfPlane(imageBuffer, 0)
        let fullHeight = CVPixelBufferGetHeightOfPlane(imageBuffer, 0)
        let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(imageBuffer, 0)

        guard let base = CVPixelBufferGetBaseAddressOfPlane(imageBuffer, 0),
              fullWidth > 0, fullHeight > 0 else { return nil }

        let luma = base.assumingMemoryBound(to: UInt8.self)

        // Center horizontal strip: columns 35 %–65 % of width
        let stripLeft  = fullWidth * 35 / 100
        let stripWidth = max(1, fullWidth * 30 / 100)

        // Search rows 20 %–80 % of height — skip edges
        let searchStart = fullHeight * 20 / 100
        let searchEnd   = fullHeight * 80 / 100
        let searchCount = searchEnd - searchStart
        guard searchCount > 2 else { return nil }

        // Per-row mean luma across strip using vDSP (SIMD-vectorised)
        var rowMeans  = [Float](repeating: 0, count: searchCount)
        var rowFloats = [Float](repeating: 0, count: stripWidth)

        for i in 0 ..< searchCount {
            let row    = searchStart + i
            let rowPtr = luma.advanced(by: row * bytesPerRow + stripLeft)
            vDSP_vfltu8(rowPtr, 1, &rowFloats, 1, vDSP_Length(stripWidth))
            var mean: Float = 0
            vDSP_meanv(rowFloats, 1, &mean, vDSP_Length(stripWidth))
            rowMeans[i] = mean
        }

        // Largest positive first-order difference = sharpest brightness drop top→bottom = waterline
        var maxDrop: Float = 0
        var waterlineIndex = searchCount / 2

        for i in 0 ..< (searchCount - 1) {
            let drop = rowMeans[i] - rowMeans[i + 1]
            if drop > maxDrop {
                maxDrop      = drop
                waterlineIndex = i
            }
        }

        let waterlineRow  = searchStart + waterlineIndex
        let waterlineYNorm = Double(waterlineRow) / Double(fullHeight)
        // 30 luma units ≈ reliable hull/water edge; clamp to [0, 1]
        let confidence = Double(min(maxDrop / 30.0, 1.0))

        return ["waterlineYNorm": waterlineYNorm, "confidence": confidence] as [String: Any]
    }
}
