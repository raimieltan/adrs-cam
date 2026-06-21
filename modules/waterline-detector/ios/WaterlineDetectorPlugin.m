#import <VisionCamera/FrameProcessorPlugin.h>
#import <VisionCamera/FrameProcessorPluginRegistry.h>
#import "waterline_detector-Swift.h"

@interface WaterlineDetectorPlugin (FrameProcessorPlugin)
@end

@implementation WaterlineDetectorPlugin (FrameProcessorPlugin)
+ (void)load {
    [FrameProcessorPluginRegistry
        addFrameProcessorPlugin:@"detectWaterline"
                withInitializer:^FrameProcessorPlugin *(VisionCameraProxyHolder *proxy,
                                                        NSDictionary *options) {
            return [[WaterlineDetectorPlugin alloc] initWithProxy:proxy withOptions:options];
        }];
}
@end
