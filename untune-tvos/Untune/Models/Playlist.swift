import Foundation

struct Playlist: Codable, Identifiable, Hashable {
    let id: Int64
    let persistentId: String
    let name: String
    let isSmart: Bool
    let isFolder: Bool
    let parentId: Int64?
    let sortOrder: Int
    let trackCount: Int
}
