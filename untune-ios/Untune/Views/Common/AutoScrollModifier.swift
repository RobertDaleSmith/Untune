import SwiftUI

/// Tracks whether the user is actively scrolling via drag gesture.
/// Provides a `userIsScrolling` flag that stays true for a short cooldown after the drag ends.
@Observable
class ScrollTracker {
    private(set) var userIsScrolling = false
    private var cooldownTask: Task<Void, Never>?

    func dragChanged() {
        cooldownTask?.cancel()
        userIsScrolling = true
    }

    func dragEnded() {
        cooldownTask?.cancel()
        cooldownTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(3))
            guard !Task.isCancelled else { return }
            userIsScrolling = false
        }
    }
}
