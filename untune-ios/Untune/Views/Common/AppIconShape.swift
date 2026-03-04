import SwiftUI

struct AppIconShape: Shape {
    func path(in rect: CGRect) -> Path {
        let scaleX = rect.width / 464
        let scaleY = rect.height / 464
        let transform = CGAffineTransform(scaleX: scaleX, y: scaleY)

        var path = Path()

        // Path 1 — sweeping curves
        path.move(to: CGPoint(x: 129.586273, y: 256.840820))
        path.addCurve(to: CGPoint(x: 39.040604, y: 276.796661),
                      control1: CGPoint(x: 99.141098, y: 263.589355),
                      control2: CGPoint(x: 69.098373, y: 270.227448))
        path.addCurve(to: CGPoint(x: 30.519245, y: 277.901276),
                      control1: CGPoint(x: 36.346027, y: 277.385559),
                      control2: CGPoint(x: 33.636112, y: 278.326355))
        path.addCurve(to: CGPoint(x: 34.109234, y: 275.650787),
                      control1: CGPoint(x: 31.141321, y: 275.777771),
                      control2: CGPoint(x: 32.820492, y: 275.943390))
        path.addCurve(to: CGPoint(x: 217.574722, y: 221.869873),
                      control1: CGPoint(x: 96.377861, y: 261.511658),
                      control2: CGPoint(x: 156.824310, y: 241.223770))
        path.addCurve(to: CGPoint(x: 344.392578, y: 179.170685),
                      control1: CGPoint(x: 260.091705, y: 208.324768),
                      control2: CGPoint(x: 301.742950, y: 192.277832))
        path.addCurve(to: CGPoint(x: 412.394043, y: 165.915283),
                      control1: CGPoint(x: 366.595184, y: 172.347336),
                      control2: CGPoint(x: 389.212158, y: 167.696976))
        path.addCurve(to: CGPoint(x: 420.374573, y: 173.050858),
                      control1: CGPoint(x: 420.162109, y: 165.318253),
                      control2: CGPoint(x: 420.379059, y: 165.495163))
        path.addCurve(to: CGPoint(x: 420.370117, y: 196.045303),
                      control1: CGPoint(x: 420.370026, y: 180.715714),
                      control2: CGPoint(x: 420.319275, y: 188.380844))
        path.addCurve(to: CGPoint(x: 416.307526, y: 200.045975),
                      control1: CGPoint(x: 420.388947, y: 198.886200),
                      control2: CGPoint(x: 419.564728, y: 200.467484))
        path.addCurve(to: CGPoint(x: 289.275940, y: 211.352066),
                      control1: CGPoint(x: 373.134857, y: 194.459076),
                      control2: CGPoint(x: 331.029633, y: 200.902924))
        path.addCurve(to: CGPoint(x: 236.933762, y: 227.506821),
                      control1: CGPoint(x: 271.538666, y: 215.790924),
                      control2: CGPoint(x: 254.183182, y: 221.455002))
        path.addCurve(to: CGPoint(x: 297.990295, y: 215.321838),
                      control1: CGPoint(x: 257.283722, y: 223.433517),
                      control2: CGPoint(x: 277.604980, y: 219.209579))
        path.addCurve(to: CGPoint(x: 393.392548, y: 207.966507),
                      control1: CGPoint(x: 329.504517, y: 209.311661),
                      control2: CGPoint(x: 361.325775, y: 206.739944))
        path.addCurve(to: CGPoint(x: 416.706299, y: 210.533386),
                      control1: CGPoint(x: 401.184998, y: 208.264572),
                      control2: CGPoint(x: 408.934967, y: 209.659317))
        path.addCurve(to: CGPoint(x: 420.329193, y: 213.722229),
                      control1: CGPoint(x: 418.677490, y: 210.755112),
                      control2: CGPoint(x: 420.330597, y: 211.265808))
        path.addCurve(to: CGPoint(x: 420.326447, y: 247.163986),
                      control1: CGPoint(x: 420.322876, y: 224.519577),
                      control2: CGPoint(x: 420.326447, y: 235.316910))
        path.addCurve(to: CGPoint(x: 234.199860, y: 235.198196),
                      control1: CGPoint(x: 358.881317, y: 225.799622),
                      control2: CGPoint(x: 296.934143, y: 223.500061))
        path.addCurve(to: CGPoint(x: 287.505219, y: 233.914612),
                      control1: CGPoint(x: 251.910538, y: 233.771820),
                      control2: CGPoint(x: 269.703796, y: 233.371109))
        path.addCurve(to: CGPoint(x: 390.015167, y: 248.812927),
                      control1: CGPoint(x: 322.232391, y: 234.974869),
                      control2: CGPoint(x: 356.573120, y: 238.857941))
        path.addCurve(to: CGPoint(x: 416.729279, y: 258.633423),
                      control1: CGPoint(x: 399.122955, y: 251.524124),
                      control2: CGPoint(x: 407.921753, y: 255.093597))
        path.addCurve(to: CGPoint(x: 420.718994, y: 263.612091),
                      control1: CGPoint(x: 419.026428, y: 259.556702),
                      control2: CGPoint(x: 420.771271, y: 260.658997))
        path.addCurve(to: CGPoint(x: 420.384247, y: 296.070953),
                      control1: CGPoint(x: 420.527466, y: 274.430267),
                      control2: CGPoint(x: 420.499634, y: 285.251282))
        path.addCurve(to: CGPoint(x: 419.498352, y: 299.397247),
                      control1: CGPoint(x: 420.372162, y: 297.205048),
                      control2: CGPoint(x: 420.528809, y: 298.424988))
        path.addCurve(to: CGPoint(x: 413.783081, y: 296.775848),
                      control1: CGPoint(x: 417.156677, y: 299.560516),
                      control2: CGPoint(x: 415.598633, y: 297.841949))
        path.addCurve(to: CGPoint(x: 271.413727, y: 245.100281),
                      control1: CGPoint(x: 369.508942, y: 270.777893),
                      control2: CGPoint(x: 322.047760, y: 253.625076))
        path.addCurve(to: CGPoint(x: 231.763840, y: 240.476486),
                      control1: CGPoint(x: 258.259369, y: 242.885590),
                      control2: CGPoint(x: 245.010056, y: 241.734985))
        path.addCurve(to: CGPoint(x: 191.636520, y: 244.546860),
                      control1: CGPoint(x: 218.146286, y: 239.182693),
                      control2: CGPoint(x: 204.914459, y: 242.451569))
        path.addCurve(to: CGPoint(x: 129.586273, y: 256.840820),
                      control1: CGPoint(x: 170.941696, y: 247.812576),
                      control2: CGPoint(x: 150.346954, y: 251.703415))
        path.closeSubpath()

        // Path 2 — letter A base
        path.move(to: CGPoint(x: 144.000000, y: 319.113892))
        path.addCurve(to: CGPoint(x: 116.000938, y: 319.085358),
                      control1: CGPoint(x: 134.333466, y: 319.119751),
                      control2: CGPoint(x: 125.166023, y: 319.198212))
        path.addCurve(to: CGPoint(x: 107.860085, y: 316.892181),
                      control1: CGPoint(x: 113.148926, y: 319.050232),
                      control2: CGPoint(x: 109.629196, y: 320.249512))
        path.addCurve(to: CGPoint(x: 110.364868, y: 309.267914),
                      control1: CGPoint(x: 106.226593, y: 313.792175),
                      control2: CGPoint(x: 108.881851, y: 311.536865))
        path.addCurve(to: CGPoint(x: 143.059708, y: 259.576538),
                      control1: CGPoint(x: 121.212776, y: 292.671234),
                      control2: CGPoint(x: 132.159775, y: 276.139282))
        path.addCurve(to: CGPoint(x: 146.368591, y: 256.781647),
                      control1: CGPoint(x: 143.898132, y: 258.302521),
                      control2: CGPoint(x: 144.719086, y: 257.173950))
        path.addCurve(to: CGPoint(x: 198.175903, y: 246.019867),
                      control1: CGPoint(x: 163.535339, y: 252.698792),
                      control2: CGPoint(x: 180.851379, y: 249.339508))
        path.addCurve(to: CGPoint(x: 199.946426, y: 247.133499),
                      control1: CGPoint(x: 198.854477, y: 245.889862),
                      control2: CGPoint(x: 199.478500, y: 246.029205))
        path.addCurve(to: CGPoint(x: 188.533371, y: 251.005829),
                      control1: CGPoint(x: 196.586700, y: 249.596542),
                      control2: CGPoint(x: 192.264023, y: 249.516357))
        path.addCurve(to: CGPoint(x: 165.069473, y: 259.521973),
                      control1: CGPoint(x: 180.809525, y: 254.089615),
                      control2: CGPoint(x: 172.921326, y: 256.766693))
        path.addCurve(to: CGPoint(x: 159.565155, y: 264.161316),
                      control1: CGPoint(x: 162.593811, y: 260.390717),
                      control2: CGPoint(x: 160.911530, y: 261.803040))
        path.addCurve(to: CGPoint(x: 140.404144, y: 296.956604),
                      control1: CGPoint(x: 153.288239, y: 275.155853),
                      control2: CGPoint(x: 146.763107, y: 286.008331))
        path.addCurve(to: CGPoint(x: 137.960129, y: 302.861053),
                      control1: CGPoint(x: 139.347794, y: 298.775330),
                      control2: CGPoint(x: 137.883408, y: 300.500641))
        path.addCurve(to: CGPoint(x: 142.689270, y: 303.720581),
                      control1: CGPoint(x: 139.349442, y: 304.298401),
                      control2: CGPoint(x: 141.119110, y: 303.718353))
        path.addCurve(to: CGPoint(x: 212.187775, y: 303.786438),
                      control1: CGPoint(x: 165.855530, y: 303.753296),
                      control2: CGPoint(x: 189.022247, y: 303.656403))
        path.addCurve(to: CGPoint(x: 218.032410, y: 298.608459),
                      control1: CGPoint(x: 216.089050, y: 303.808319),
                      control2: CGPoint(x: 217.597244, y: 302.812378))
        path.addCurve(to: CGPoint(x: 220.687561, y: 257.779877),
                      control1: CGPoint(x: 219.438782, y: 285.022766),
                      control2: CGPoint(x: 220.874207, y: 271.440857))
        path.addCurve(to: CGPoint(x: 226.836533, y: 250.580231),
                      control1: CGPoint(x: 220.622803, y: 253.040726),
                      control2: CGPoint(x: 222.615402, y: 251.470413))
        path.addCurve(to: CGPoint(x: 274.826569, y: 253.284088),
                      control1: CGPoint(x: 243.107361, y: 247.148972),
                      control2: CGPoint(x: 259.015106, y: 249.876724))
        path.addCurve(to: CGPoint(x: 299.365021, y: 260.088654),
                      control1: CGPoint(x: 283.109863, y: 255.069153),
                      control2: CGPoint(x: 291.182983, y: 257.822876))
        path.addCurve(to: CGPoint(x: 304.795807, y: 264.077881),
                      control1: CGPoint(x: 301.713989, y: 260.739136),
                      control2: CGPoint(x: 303.431946, y: 261.945404))
        path.addCurve(to: CGPoint(x: 334.070892, y: 309.436768),
                      control1: CGPoint(x: 314.491394, y: 279.237671),
                      control2: CGPoint(x: 324.304138, y: 294.322479))
        path.addCurve(to: CGPoint(x: 335.848785, y: 312.449219),
                      control1: CGPoint(x: 334.703339, y: 310.415527),
                      control2: CGPoint(x: 335.310608, y: 311.416504))
        path.addCurve(to: CGPoint(x: 331.996246, y: 318.996704),
                      control1: CGPoint(x: 338.259369, y: 317.074646),
                      control2: CGPoint(x: 337.285919, y: 318.920654))
        path.addCurve(to: CGPoint(x: 300.497467, y: 319.077576),
                      control1: CGPoint(x: 321.498413, y: 319.147675),
                      control2: CGPoint(x: 310.997253, y: 319.074615))
        path.addCurve(to: CGPoint(x: 144.000000, y: 319.113892),
                      control1: CGPoint(x: 248.498306, y: 319.092255),
                      control2: CGPoint(x: 196.499161, y: 319.101562))
        path.closeSubpath()

        // Path 3 — letter A peak
        path.move(to: CGPoint(x: 248.754211, y: 162.316620))
        path.addCurve(to: CGPoint(x: 269.053131, y: 198.577621),
                      control1: CGPoint(x: 255.656036, y: 174.637131),
                      control2: CGPoint(x: 262.372528, y: 186.639465))
        path.addCurve(to: CGPoint(x: 157.626953, y: 233.240036),
                      control1: CGPoint(x: 255.323914, y: 209.150604),
                      control2: CGPoint(x: 175.441696, y: 234.157806))
        path.addCurve(to: CGPoint(x: 222.155914, y: 116.201599),
                      control1: CGPoint(x: 180.247482, y: 194.486267),
                      control2: CGPoint(x: 201.724686, y: 155.632721))
        path.addCurve(to: CGPoint(x: 224.080368, y: 116.137108),
                      control1: CGPoint(x: 222.797394, y: 116.180099),
                      control2: CGPoint(x: 223.438889, y: 116.158600))
        path.addCurve(to: CGPoint(x: 248.754211, y: 162.316620),
                      control1: CGPoint(x: 232.243210, y: 131.424210),
                      control2: CGPoint(x: 240.406036, y: 146.711319))

        // Inner cutout
        path.move(to: CGPoint(x: 237.701035, y: 175.677628))
        path.addCurve(to: CGPoint(x: 224.436981, y: 135.621613),
                      control1: CGPoint(x: 233.251160, y: 162.239456),
                      control2: CGPoint(x: 228.801270, y: 148.801300))
        path.addCurve(to: CGPoint(x: 222.386063, y: 215.459503),
                      control1: CGPoint(x: 222.584656, y: 161.814697),
                      control2: CGPoint(x: 223.876938, y: 188.293762))
        path.addCurve(to: CGPoint(x: 243.157410, y: 204.884949),
                      control1: CGPoint(x: 229.881592, y: 211.624268),
                      control2: CGPoint(x: 236.463516, y: 208.139481))
        path.addCurve(to: CGPoint(x: 245.685532, y: 198.537247),
                      control1: CGPoint(x: 246.134583, y: 203.437454),
                      control2: CGPoint(x: 246.834808, y: 201.639526))
        path.addCurve(to: CGPoint(x: 237.701035, y: 175.677628),
                      control1: CGPoint(x: 242.973434, y: 191.216339),
                      control2: CGPoint(x: 240.508301, y: 183.803940))
        path.closeSubpath()

        return path.applying(transform)
    }
}
