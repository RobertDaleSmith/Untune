import SwiftUI
import UIKit

struct SettingsView: View {
    @Environment(PairingManager.self) private var pairingManager
    @Environment(DesktopDiscovery.self) private var discovery
    @Environment(SyncEngine.self) private var syncEngine

    @State private var trackCount = 0
    @State private var downloadedCount = 0
    @State private var dbSize: Int64 = 0
    @State private var musicSize: Int64 = 0
    @State private var artworkSize: Int64 = 0
    @State private var showPairing = false
    @State private var showPlaylistPicker = false

    @AppStorage("appearanceMode") private var appearanceMode: AppearanceMode = .system
    @State private var currentIconName: String? = UIApplication.shared.alternateIconName
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                appearanceSection
                syncSection
                librarySection
                storageSection
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
            .sheet(isPresented: $showPlaylistPicker) {
                PlaylistSyncPickerView()
            }
            .onChange(of: syncEngine.state) { _, newState in
                showPlaylistPicker = newState == .awaitingSelection
            }
        }
    }

    // MARK: - Appearance Section

    private var appearanceSection: some View {
        Section("Appearance") {
            Picker("Theme", selection: $appearanceMode) {
                ForEach(AppearanceMode.allCases, id: \.self) { mode in
                    Text(mode.label).tag(mode)
                }
            }
            .pickerStyle(.segmented)

            VStack(alignment: .leading, spacing: 8) {
                Text("App Icon")
                    .font(.subheadline)
                HStack(spacing: 16) {
                    iconOption(name: nil, label: "Default")
                    iconOption(name: "Light", label: "Light")
                    iconOption(name: "Dark", label: "Dark")
                }
            }
            .padding(.vertical, 4)
        }
    }

    private func iconOption(name: String?, label: String) -> some View {
        let isSelected = currentIconName == name
        let imageName: String = {
            switch name {
            case "Light": return "icon-light"
            case "Dark": return "icon-dark"
            default: return "AppIcon"
            }
        }()

        return Button {
            UIApplication.shared.setAlternateIconName(name) { error in
                if error == nil {
                    currentIconName = name
                }
            }
        } label: {
            VStack(spacing: 6) {
                if name == nil, let primaryIcon = Bundle.main.icon {
                    Image(uiImage: primaryIcon)
                        .resizable()
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 13.5))
                } else {
                    Image(uiImage: loadAlternateIcon(imageName))
                        .resizable()
                        .frame(width: 60, height: 60)
                        .clipShape(RoundedRectangle(cornerRadius: 13.5))
                }
                Text(label)
                    .font(.caption)
                    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
            }
            .overlay(
                RoundedRectangle(cornerRadius: 13.5)
                    .stroke(isSelected ? Color.accentColor : .clear, lineWidth: 2)
                    .frame(width: 64, height: 64),
                alignment: .top
            )
        }
        .buttonStyle(.plain)
    }

    private func loadAlternateIcon(_ name: String) -> UIImage {
        // Try @3x first, then @2x
        if let img = UIImage(named: "\(name)@3x", in: .main, with: nil) { return img }
        if let img = UIImage(named: "\(name)@2x", in: .main, with: nil) { return img }
        if let img = UIImage(named: name, in: .main, with: nil) { return img }
        return UIImage(systemName: "app.fill") ?? UIImage()
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
                    Task { await syncEngine.fetchPlaylistsForSelection() }
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
        case .idle, .awaitingSelection:
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
        }
    }

    private var storageSection: some View {
        Section("Storage") {
            LabeledContent("Music") {
                Text(formatBytes(musicSize))
            }
            LabeledContent("Artwork") {
                Text(formatBytes(artworkSize))
            }
            LabeledContent("Database") {
                Text(formatBytes(dbSize))
            }
            LabeledContent("Total") {
                Text(formatBytes(musicSize + artworkSize + dbSize))
                    .bold()
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

        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask).first!
        musicSize = directorySize(docs.appendingPathComponent("Music"))

        let appSupport = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        artworkSize = directorySize(appSupport.appendingPathComponent("Artwork"))
    }

    private func directorySize(_ url: URL) -> Int64 {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles]) else {
            return 0
        }
        var total: Int64 = 0
        for case let fileURL as URL in enumerator {
            if let size = try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize {
                total += Int64(size)
            }
        }
        return total
    }

    private func formatBytes(_ bytes: Int64) -> String {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter.string(fromByteCount: bytes)
    }
}

extension Bundle {
    var icon: UIImage? {
        guard let icons = infoDictionary?["CFBundleIcons"] as? [String: Any],
              let primary = icons["CFBundlePrimaryIcon"] as? [String: Any],
              let files = primary["CFBundleIconFiles"] as? [String],
              let name = files.last else { return nil }
        return UIImage(named: name)
    }
}
