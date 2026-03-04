import SwiftUI

struct MarqueeText: View {
    let text: String
    let font: Font
    let speed: Double

    @State private var offset: CGFloat = 0
    @State private var textWidth: CGFloat = 0
    @State private var containerWidth: CGFloat = 0
    @State private var animating = false

    init(_ text: String, font: Font = .body, speed: Double = 30) {
        self.text = text
        self.font = font
        self.speed = speed
    }

    var body: some View {
        GeometryReader { geo in
            let needsScroll = textWidth > geo.size.width

            Group {
                if needsScroll {
                    HStack(spacing: 40) {
                        Text(text)
                            .font(font)
                            .fixedSize()
                        Text(text)
                            .font(font)
                            .fixedSize()
                    }
                    .offset(x: offset)
                } else {
                    Text(text)
                        .font(font)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: geo.size.height)
            .onAppear {
                containerWidth = geo.size.width
                if needsScroll { startAnimation() }
            }
            .onChange(of: text) {
                containerWidth = geo.size.width
                offset = 0
                animating = false
                measureAndAnimate()
            }
            .onChange(of: geo.size.width) {
                containerWidth = geo.size.width
            }
        }
        // Use the font's line height for the frame, not the text content width
        .frame(height: fontLineHeight)
        .clipped()
        // Measure text width off-screen without affecting layout
        .background(
            Text(text)
                .font(font)
                .fixedSize()
                .background(GeometryReader { geo in
                    Color.clear
                        .onAppear { textWidth = geo.size.width }
                        .onChange(of: text) { textWidth = geo.size.width }
                })
                .hidden()
                .frame(width: 0, height: 0)
                .clipped()
        )
    }

    private var fontLineHeight: CGFloat {
        // Approximate line height from UIFont for the given Font style
        UIFont.preferredFont(forTextStyle: .title2).lineHeight + 4
    }

    private func measureAndAnimate() {
        // Small delay to let measurement update
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            if textWidth > containerWidth {
                startAnimation()
            }
        }
    }

    private func startAnimation() {
        guard !animating else { return }
        animating = true
        let totalWidth = textWidth + 40
        let animDuration = totalWidth / speed

        offset = 0
        withAnimation(.linear(duration: animDuration).repeatForever(autoreverses: false)) {
            offset = -totalWidth
        }
    }
}
