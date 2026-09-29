// Encode rendered AE PNG frames as H.264 without an extra encoder dependency.
import Foundation
import AVFoundation
import AppKit
let args = CommandLine.arguments
if args.count != 3 { fatalError("Usage: swift encode-preview.swift frames-directory output.mp4") }
let directory = URL(fileURLWithPath: args[1])
let output = URL(fileURLWithPath: args[2])
if FileManager.default.fileExists(atPath: output.path) { fatalError("Output already exists; choose a new file") }
let writer = try AVAssetWriter(outputURL: output, fileType: .mp4)
let width = 1600, height = 900
let input = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264, AVVideoWidthKey: width, AVVideoHeightKey: height, AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 20000000]])
let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB, kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height])
writer.add(input)
guard writer.startWriting() else { fatalError(String(describing: writer.error)) }
writer.startSession(atSourceTime: .zero)
for i in 0..<60 {
  let url = directory.appendingPathComponent("batch-\(i/30)_\(i%30).png")
  guard let image = NSImage(contentsOf: url), let cg = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else { fatalError("Missing frame \(url.path)") }
  while !input.isReadyForMoreMediaData { Thread.sleep(forTimeInterval: 0.01) }
  var buffer: CVPixelBuffer?
  guard CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer) == kCVReturnSuccess, let pixel = buffer else { fatalError("Pixel buffer failed") }
  CVPixelBufferLockBaseAddress(pixel, [])
  let context = CGContext(data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height, bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel), space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue)!
  context.draw(cg, in: CGRect(x:0,y:0,width:width,height:height))
  CVPixelBufferUnlockBaseAddress(pixel, [])
  guard adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(i), timescale: 15)) else { fatalError(String(describing: writer.error)) }
}
input.markAsFinished()
let done = DispatchSemaphore(value:0)
writer.finishWriting { done.signal() }
done.wait()
guard writer.status == .completed else { fatalError(String(describing: writer.error)) }
print("Encoded 60 native AE frames: \(output.path)")
