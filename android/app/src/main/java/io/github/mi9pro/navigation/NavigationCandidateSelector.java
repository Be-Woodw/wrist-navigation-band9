package io.github.mi9pro.navigation;

/** Choose actionable Gaode guidance ahead of a newer generic ongoing-status card. */
final class NavigationCandidateSelector {
    private NavigationParser.Result guidance;
    private long guidancePostedAt = Long.MIN_VALUE;
    private int guidancePriority = -1;
    private NavigationParser.Result ended;
    private long endedPostedAt = Long.MIN_VALUE;

    void consider(NavigationParser.Result candidate, long postedAt) {
        if (candidate == null) return;
        if ("ended".equals(candidate.status)) {
            // Explicit completion after an active instruction must end that route.
            if (ended == null || postedAt >= endedPostedAt) {
                ended = candidate;
                endedPostedAt = postedAt;
            }
            return;
        }
        int priority = priority(candidate);
        if (guidance == null || priority > guidancePriority ||
                (priority == guidancePriority && postedAt >= guidancePostedAt)) {
            guidance = candidate;
            guidancePostedAt = postedAt;
            guidancePriority = priority;
        }
    }

    NavigationParser.Result selected() {
        if (ended != null && (guidance == null || endedPostedAt >= guidancePostedAt)) return ended;
        return guidance;
    }

    private static int priority(NavigationParser.Result candidate) {
        if (!"active".equals(candidate.status) || candidate.maneuver == null ||
                "unknown".equals(candidate.maneuver) || "arrive".equals(candidate.maneuver)) return 0;
        return candidate.distance == null || candidate.distance.isEmpty() ? 1 : 2;
    }
}
