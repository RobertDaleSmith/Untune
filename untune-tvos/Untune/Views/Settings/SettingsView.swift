import SwiftUI

struct SettingsView: View {
    @Environment(PairingManager.self) private var pairingManager
    @Environment(SyncEngine.self) private var syncEngine
    @Environment(HandoffManager.self) private var handoffManager

    var body: some View {
        NavigationStack {
            List {
                // Connection status
                Section("Desktop Connection") {
                    if pairingManager.isPaired {
                        HStack {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(.green)
                            VStack(alignment: .leading) {
                                Text("Connected to \(pairingManager.desktopName ?? "Desktop")")
                                    .font(.body)
                                Text(pairingManager.baseURL ?? "")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        Button("Sync Now") {
                            Task {
                                await syncEngine.sync()
                            }
                        }

                        // Sync status
                        if syncEngine.state != .idle {
                            HStack {
                                if syncEngine.state == .done {
                                    Image(systemName: "checkmark.circle")
                                        .foregroundStyle(.green)
                                } else if case .error = syncEngine.state {
                                    Image(systemName: "exclamationmark.triangle")
                                        .foregroundStyle(.red)
                                } else {
                                    ProgressView()
                                }
                                Text(syncStatusText)
                                    .font(.subheadline)
                            }
                        }

                        Button("Unpair", role: .destructive) {
                            pairingManager.unpair()
                        }
                    } else {
                        NavigationLink("Connect to Desktop") {
                            PairingView()
                        }
                    }
                }

                // Handoff
                Section("Handoff") {
                    @Bindable var hm = handoffManager
                    LabeledContent("Status") {
                        Text(handoffManager.isConfigured ? "Configured" : "Not configured")
                            .foregroundStyle(handoffManager.isConfigured ? .green : .secondary)
                    }
                    LabeledContent("Server URL") {
                        TextField("https://your-project.vercel.app", text: $hm.url)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                    LabeledContent("Token") {
                        TextField("Paste token from desktop", text: $hm.token)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                    }
                }

                // Library info
                Section("Library") {
                    let count = (try? DatabaseManager.shared.trackCount()) ?? 0
                    HStack {
                        Text("Tracks")
                        Spacer()
                        Text("\(count)")
                            .foregroundStyle(.secondary)
                    }
                }

                // About
                Section("About") {
                    HStack {
                        Text("Version")
                        Spacer()
                        Text("1.0.0")
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .navigationTitle("Settings")
        }
    }

    private var syncStatusText: String {
        switch syncEngine.state {
        case .idle: return ""
        case .discovering: return "Discovering desktop..."
        case .connecting: return "Connecting..."
        case .syncingMetadata: return "Syncing metadata (\(syncEngine.progress.syncedTracks)/\(syncEngine.progress.totalTracks))..."
        case .syncingArtwork: return "Downloading artwork (\(syncEngine.progress.downloadedArtwork)/\(syncEngine.progress.totalArtwork))..."
        case .uploadingPlayStats: return "Uploading play stats..."
        case .done: return "Sync complete"
        case .error(let msg): return "Error: \(msg)"
        }
    }
}
