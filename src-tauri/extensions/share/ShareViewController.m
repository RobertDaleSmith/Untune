#import <Cocoa/Cocoa.h>

@interface ShareViewController : NSViewController
@end

@implementation ShareViewController

- (void)loadView {
    self.view = [[NSView alloc] initWithFrame:NSZeroRect];
}

- (void)beginRequestWithExtensionContext:(NSExtensionContext *)context {
    NSExtensionItem *item = context.inputItems.firstObject;
    NSItemProvider *provider = item.attachments.firstObject;

    if ([provider hasItemConformingToTypeIdentifier:@"public.url"]) {
        [provider loadItemForTypeIdentifier:@"public.url"
                                    options:nil
                          completionHandler:^(NSURL *url, NSError *error) {
            if (url) {
                NSString *encoded = [url.absoluteString stringByAddingPercentEncodingWithAllowedCharacters:
                    [NSCharacterSet URLQueryAllowedCharacterSet]];
                NSString *deepLinkStr = [NSString stringWithFormat:@"untune://add?url=%@", encoded];
                NSURL *deepLink = [NSURL URLWithString:deepLinkStr];
                if (deepLink) {
                    [[NSWorkspace sharedWorkspace] openURL:deepLink];
                }
            }
            [context completeRequestReturningItems:nil completionHandler:nil];
        }];
    } else if ([provider hasItemConformingToTypeIdentifier:@"public.plain-text"]) {
        [provider loadItemForTypeIdentifier:@"public.plain-text"
                                    options:nil
                          completionHandler:^(NSString *text, NSError *error) {
            if (text) {
                NSURL *textUrl = [NSURL URLWithString:text];
                if (textUrl && [textUrl.scheme hasPrefix:@"http"]) {
                    NSString *encoded = [text stringByAddingPercentEncodingWithAllowedCharacters:
                        [NSCharacterSet URLQueryAllowedCharacterSet]];
                    NSString *deepLinkStr = [NSString stringWithFormat:@"untune://add?url=%@", encoded];
                    NSURL *deepLink = [NSURL URLWithString:deepLinkStr];
                    if (deepLink) {
                        [[NSWorkspace sharedWorkspace] openURL:deepLink];
                    }
                }
            }
            [context completeRequestReturningItems:nil completionHandler:nil];
        }];
    } else {
        [context completeRequestReturningItems:nil completionHandler:nil];
    }
}

@end
