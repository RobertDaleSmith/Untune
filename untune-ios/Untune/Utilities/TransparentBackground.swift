import SwiftUI
import UIKit

/// A UIViewRepresentable that clears the background of its hosting view hierarchy,
/// making NavigationStack and other container backgrounds transparent.
struct TransparentBackground: UIViewRepresentable {
    func makeUIView(context: Context) -> UIView {
        let view = TransparentBackgroundView()
        view.isUserInteractionEnabled = false
        return view
    }

    func updateUIView(_ uiView: UIView, context: Context) {}
}

private class TransparentBackgroundView: UIView {
    override func didMoveToWindow() {
        super.didMoveToWindow()
        // Walk up the view hierarchy and clear backgrounds
        superview?.walkUp { view in
            view.backgroundColor = .clear
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        superview?.walkUp { view in
            view.backgroundColor = .clear
        }
    }
}

private extension UIView {
    func walkUp(applying: (UIView) -> Void) {
        applying(self)
        superview?.walkUp(applying: applying)
    }
}
