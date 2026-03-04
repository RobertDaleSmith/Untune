import SwiftUI

struct Star: Identifiable {
    let id = UUID()
    let x: CGFloat          // 0...1 fraction across screen
    let size: CGFloat        // 0.6...2.6 pt
    let driftDuration: Double // 40...120s
    let twinkleDuration: Double // 4...12s
    let alpha: Double        // 0.1...0.55
    let driftOffset: Double  // random phase offset
    let twinkleOffset: Double
}

struct StarfieldView: View {
    let stars: [Star]
    let starColor: Color

    var body: some View {
        GeometryReader { geo in
            ZStack {
                ForEach(stars) { star in
                    StarParticle(star: star, height: geo.size.height, starColor: starColor)
                        .position(x: star.x * geo.size.width, y: geo.size.height)
                }
            }
        }
        .ignoresSafeArea()
    }
}

struct StarParticle: View {
    let star: Star
    let height: CGFloat
    let starColor: Color
    @State private var driftActive = false
    @State private var twinkleActive = false

    var body: some View {
        Circle()
            .fill(starColor.opacity(star.alpha))
            .frame(width: star.size, height: star.size)
            .opacity(twinkleActive ? 1.0 : 0.3)
            .offset(y: driftActive ? -(height + 10) : 0)
            .onAppear {
                withAnimation(
                    .linear(duration: star.driftDuration)
                    .repeatForever(autoreverses: false)
                    .delay(-star.driftOffset)
                ) {
                    driftActive = true
                }
                withAnimation(
                    .easeInOut(duration: star.twinkleDuration)
                    .repeatForever(autoreverses: true)
                    .delay(-star.twinkleOffset)
                ) {
                    twinkleActive = true
                }
            }
    }
}

struct SplashView<Content: View>: View {
    @Environment(\.colorScheme) private var colorScheme
    @State private var isActive = false
    @State private var spinning = false
    let content: () -> Content

    private let stars: [Star] = (0..<70).map { _ in
        Star(
            x: CGFloat.random(in: 0...1),
            size: CGFloat.random(in: 0.6...2.6),
            driftDuration: Double.random(in: 40...120),
            twinkleDuration: Double.random(in: 4...12),
            alpha: Double.random(in: 0.1...0.55),
            driftOffset: Double.random(in: 0...120),
            twinkleOffset: Double.random(in: 0...12)
        )
    }

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        ZStack {
            if isActive {
                content()
                    .transition(.opacity)
            } else {
                ZStack {
                    Color(red: isDark ? 0.004 : 0.996,
                          green: isDark ? 0.004 : 0.996,
                          blue: isDark ? 0.004 : 0.996)
                        .ignoresSafeArea()

                    StarfieldView(stars: stars, starColor: isDark ? .white : .black)

                    VStack(spacing: 32) {
                        AppIconShape()
                            .fill(isDark ? Color.white : Color.black)
                            .frame(width: 140, height: 140)

                        Circle()
                            .trim(from: 0.0, to: 0.75)
                            .stroke(
                                AngularGradient(
                                    colors: isDark
                                        ? [Color(white: 0.25), Color(white: 0.64)]
                                        : [Color(white: 0.83), Color(white: 0.32)],
                                    center: .center
                                ),
                                style: StrokeStyle(lineWidth: 2.5, lineCap: .round)
                            )
                            .frame(width: 33, height: 33)
                            .rotationEffect(.degrees(spinning ? 360 : 0))
                            .onAppear {
                                withAnimation(
                                    .linear(duration: 0.8)
                                    .repeatForever(autoreverses: false)
                                ) {
                                    spinning = true
                                }
                            }
                    }
                }
                .transition(.opacity)
            }
        }
        .animation(.easeInOut(duration: 0.4), value: isActive)
        .onAppear {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
                isActive = true
            }
        }
    }
}
