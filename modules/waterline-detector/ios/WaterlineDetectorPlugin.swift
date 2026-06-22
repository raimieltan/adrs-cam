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

        let planeCount = CVPixelBufferGetPlaneCount(imageBuffer)

        if planeCount >= 1 {
            // YUV420 — plane 0 is the luma (Y) channel, 1 byte per pixel
            return detectFromLumaPlane(imageBuffer)
        } else {
            // BGRA — non-planar, use green channel (offset 1) as luminance proxy
            return detectFromBGRA(imageBuffer)
        }
    }

    private func detectFromLumaPlane(_ buf: CVPixelBuffer) -> [String: Any]? {
        let width      = CVPixelBufferGetWidthOfPlane(buf, 0)
        let height     = CVPixelBufferGetHeightOfPlane(buf, 0)
        let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(buf, 0)
        guard let base = CVPixelBufferGetBaseAddressOfPlane(buf, 0),
              width > 0, height > 0 else { return nil }

        let luma = base.assumingMemoryBound(to: UInt8.self)
        let stripLeft  = width * 35 / 100
        let stripWidth = max(1, width * 30 / 100)
        let searchStart = height * 15 / 100
        let searchEnd   = height * 92 / 100
        let searchCount = searchEnd - searchStart
        guard searchCount > 2 else { return nil }

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

        return findWaterline(rowMeans: rowMeans, searchStart: searchStart, totalHeight: height)
    }

    private func detectFromBGRA(_ buf: CVPixelBuffer) -> [String: Any]? {
        let width      = CVPixelBufferGetWidth(buf)
        let height     = CVPixelBufferGetHeight(buf)
        let bytesPerRow = CVPixelBufferGetBytesPerRow(buf)
        guard let base = CVPixelBufferGetBaseAddress(buf),
              width > 0, height > 0 else { return nil }

        let pixels = base.assumingMemoryBound(to: UInt8.self)
        let stripLeft  = width * 35 / 100
        let stripWidth = max(1, width * 30 / 100)
        let searchStart = height * 15 / 100
        let searchEnd   = height * 92 / 100
        let searchCount = searchEnd - searchStart
        guard searchCount > 2 else { return nil }

        // Sample the green channel (BGRA offset 1) — good luminance proxy
        var rowMeans = [Float](repeating: 0, count: searchCount)
        for i in 0 ..< searchCount {
            let row = searchStart + i
            var sum: Float = 0
            for col in 0 ..< stripWidth {
                let offset = row * bytesPerRow + (stripLeft + col) * 4 + 1
                sum += Float(pixels[offset])
            }
            rowMeans[i] = sum / Float(stripWidth)
        }

        return findWaterline(rowMeans: rowMeans, searchStart: searchStart, totalHeight: height)
    }

    private func findWaterline(rowMeans: [Float], searchStart: Int, totalHeight: Int) -> [String: Any]? {
        let n = rowMeans.count
        guard n > 6 else { return nil }

        // Prefix sums for O(1) windowed mean queries
        var prefix = [Float](repeating: 0, count: n + 1)
        for i in 0 ..< n { prefix[i + 1] = prefix[i] + rowMeans[i] }
        func mean(_ lo: Int, _ hi: Int) -> Float {
            let c = hi - lo
            return c > 0 ? (prefix[hi] - prefix[lo]) / Float(c) : 0
        }

        // Windowed split-mean: hull seams produce a temporary dark band then recover;
        // the real waterline keeps everything below dark. Window ~12% of search range.
        let half = max(4, n / 8)
        var bestScore: Float = 0
        var bestIndex = n / 2

        for i in half ..< (n - half) {
            let score = mean(i - half, i) - mean(i, i + half)
            if score > bestScore {
                bestScore = score
                bestIndex = i
            }
        }

        let waterlineRow   = searchStart + bestIndex
        let waterlineYNorm = Double(waterlineRow) / Double(totalHeight)
        // 20 luma units across the window ≈ reliable edge
        let confidence = Double(min(bestScore / 20.0, 1.0))

        return ["waterlineYNorm": waterlineYNorm, "confidence": confidence]
    }
}
