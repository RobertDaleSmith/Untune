import SwiftUI

struct SettingsView: View {
    @Environment(PairingManager.self) private var pairingManager
    @Environment(DesktopDiscovery.self) private var discovery
    @Environment(SyncEngine.self) private var syncEngine

    @State private var trackCount = 0
    @State private var downloadedCount = 0
    @State private var dbSize: Int64 = 0
    @State private var showPairing = false

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                syncSection
                librarySection
                aboutSection
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { dismiss() } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .onAppear(perform: loadStats)
            .sheet(isPresented: $showPairing) {
                PairingView()
            }
        }
    }

    // MARK: - Sync Section

    @ViewBuilder
    private var syncSection: some View {
        Section("Sync") {
            if pairingManager.isPaired {
                // Paired state
                LabeledContent("Desktop") {
                    Text(pairingManager.desktopName ?? "Unknown")
                }

                // Sync status
                syncStatusRow

                // Sync button
                Button {
                    Task { await syncEngine.startSync() }
                } label: {
                    Label("Sync Now", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(syncEngine.state != .idle && syncEngine.state != .done && syncEngine.state != .error)

                // Unpair
                Button(role: .destructive) {
                    pairingManager.unpair()
                } label: {
                    Label("Unpair Desktop", systemImage: "xmark.circle")
                }
            } else {
                // Not paired
                Button {
                    showPairing = true
                } label: {
                    Label("Pair with Desktop", systemImage: "link")
                }

                Text("Connect to your desktop Untune app to sync playlists and music.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    @ViewBuilder
    private var syncStatusRow: some View {
        switch syncEngine.state {
        case .idle:
            HStack {
                Image(systemName: "checkmark.circle")
                    .foregroundStyle(.green)
                Text("Ready to sync")
                    .foregroundStyle(.secondary)
            }
        case .done:
            HStack {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(.green)
                Text("Sync complete")
                    .foregroundStyle(.secondary)
            }
        case .error:
            HStack {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                Text(syncEngine.errorMessage ?? "Sync failed")
                    .foregroundStyle(.red)
                    .font(.caption)
            }
        default:
            // In progress
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    ProgressView()
                        .controlSize(.small)
                    Text(syncEngine.progress.phase)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                if syncEngine.state == .syncingFiles && syncEngine.progress.totalTracks > 0 {
                    ProgressView(
                        value: Double(syncEngine.progress.downloadedTracks),
                        total: Double(syncEngine.progress.totalTracks)
                    )
                    Text("\(syncEngine.progress.downloadedTracks)/\(syncEngine.progress.totalTracks) tracks")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if syncEngine.state == .syncingArtwork && syncEngine.progress.totalArtwork > 0 {
                    ProgressView(
                        value: Double(syncEngine.progress.downloadedArtwork),
                        total: Double(syncEngine.progress.totalArtwork)
                    )
                    Text("\(syncEngine.progress.downloadedArtwork)/\(syncEngine.progress.totalArtwork) artwork")
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
            }
        }
    }

    // MARK: - Library Section

    private var librarySection: some View {
        Section("Library") {
            LabeledContent("Total Tracks") {
                Text("\(trackCount)")
            }
            LabeledContent("Downloaded") {
                Text("\(downloadedCount)")
            }
            LabeledContent("Database Size") {
                Text(formatBytes(dbSize))
            }
        }
    }

    // MARK: - About Section

    private var aboutSection: some View {
        Section("About") {
            LabeledContent("Version") {
                Text("1.0.0")
            }
            LabeledContent("Build") {
                Text("1")
            }
        }
    }

    // MARK: - Helpers

    private func loadStats() {
        do {
            trackCount = try DatabaseManager.shared.trackCount()
            downloadedCount = try DatabaseManager.shared.downloadedTrackCount()
            dbSize = DatabaseManager.shared.databaseSize()
        } catch {
            print("Failed to load stats: \(error)")
        }
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}
