import SwiftUI

struct ArtworkView: View {
    let artworkHash: String?
    let size: CGFloat
    let cornerRadius: CGFloat

    @Environment(PairingManager.self) private var pairingManager
    @State private var image: UIImage?

    init(artworkHash: String?, size: CGFloat = 200, cornerRadius: CGFloat = 12) {
        self.artworkHash = artworkHash
        self.size = size
        self.cornerRadius = cornerRadius
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
            } else {
                ZStack {
                    Color(.separator).opacity(0.3)
                    Image(systemName: "music.note")
                        .font(.system(size: size * 0.3))
                        .foregroundStyle(.secondary)
                }
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius))
        .task(id: artworkHash) {
            guard let hash = artworkHash else {
                image = nil
                return
            }
            image = await ArtworkLoader.shared.image(
                forHash: hash,
                baseURL: pairingManager.baseURL,
                authToken: pairingManager.authToken()
            )
        }
    }
}
