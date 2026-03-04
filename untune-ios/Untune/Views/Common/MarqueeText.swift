import SwiftUI

struct MarqueeText: View {
    let text: String
    let font: Font
    let cycleDuration: Double

    @State private var textWidth: CGFloat = 0
    @State private var containerWidth: CGFloat = 0
    @State private var phase: AnimationPhase = .restStart
    @State private var animationTask: Task<Void, Never>?

    /// Matches the desktop's 8s cycle: rest → scroll left → rest → scroll back
    private enum AnimationPhase {
        case restStart      // 0-15%: text at start position
        case scrollLeft     // 15-40%: text slides left to reveal overflow
        case restEnd        // 40-55%: text paused at scrolled position
        case scrollBack     // 55-80%: text slides back to start
        case restFinal      // 80-100%: text at start, before next cycle
    }

    init(_ text: String, font: Font = .body, cycleDuration: Double = 8) {
        self.text = text
        self.font = font
        self.cycleDuration = cycleDuration
    }

    private var overflow: CGFloat {
        max(0, textWidth - containerWidth)
    }

    private var needsScroll: Bool {
        overflow > 0
    }

    private var currentOffset: CGFloat {
        switch phase {
        case .restStart, .restFinal:
            return 0
        case .scrollLeft, .restEnd:
            return -overflow
        case .scrollBack:
            return 0
        }
    }

    var body: some View {
        GeometryReader { geo in
            let fits = textWidth <= geo.size.width

            Text(text)
                .font(font)
                .fixedSize()
                .frame(maxWidth: fits ? geo.size.width : nil)
                .offset(x: fits ? 0 : currentOffset)
                .onAppear {
                    containerWidth = geo.size.width
                    startIfNeeded()
                }
                .onChange(of: text) {
                    cancelAnimation()
                    containerWidth = geo.size.width
                    phase = .restStart
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                        startIfNeeded()
                    }
                }
                .onChange(of: geo.size.width) {
                    containerWidth = geo.size.width
                }
        }
        .frame(height: fontLineHeight)
        .clipped()
        // Measure text width off-screen
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
        .onDisappear {
            cancelAnimation()
        }
    }

    private var fontLineHeight: CGFloat {
        UIFont.preferredFont(forTextStyle: .title2).lineHeight + 4
    }

    private func cancelAnimation() {
        animationTask?.cancel()
        animationTask = nil
    }

    private func startIfNeeded() {
        guard needsScroll else { return }
        cancelAnimation()
        animationTask = Task { @MainActor in
            // Initial rest before first scroll
            try? await Task.sleep(for: .milliseconds(Int(cycleDuration * 0.15 * 1000)))

            while !Task.isCancelled {
                // Scroll left (15% → 40% = 25% of cycle)
                let scrollDuration = cycleDuration * 0.25
                withAnimation(.easeInOut(duration: scrollDuration)) {
                    phase = .scrollLeft
                }
                try? await Task.sleep(for: .milliseconds(Int(scrollDuration * 1000)))
                if Task.isCancelled { break }

                // Rest at end (40% → 55% = 15% of cycle)
                phase = .restEnd
                try? await Task.sleep(for: .milliseconds(Int(cycleDuration * 0.15 * 1000)))
                if Task.isCancelled { break }

                // Scroll back (55% → 80% = 25% of cycle)
                withAnimation(.easeInOut(duration: cycleDuration * 0.25)) {
                    phase = .scrollBack
                }
                try? await Task.sleep(for: .milliseconds(Int(cycleDuration * 0.25 * 1000)))
                if Task.isCancelled { break }

                // Rest at start (80% → 100% = 20% of cycle)
                phase = .restFinal
                try? await Task.sleep(for: .milliseconds(Int(cycleDuration * 0.20 * 1000)))
                if Task.isCancelled { break }

                // Reset for next cycle
                phase = .restStart
            }
        }
    }
}
