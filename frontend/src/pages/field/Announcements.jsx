// frontend/src/pages/field/Announcements.jsx
import { useEffect, useState } from "react";
import { Card } from "../../components/ui";

const API_BASE = import.meta.env.VITE_API_BASE || "";

export default function Announcements() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Fetch announcements for field researchers
  useEffect(() => {
    const fetchAnnouncements = async () => {
      try {
        setLoading(true);
        const res = await fetch(`${API_BASE}/api/announcements/field`);
        
        if (!res.ok) {
          throw new Error(`Failed to fetch announcements: ${res.status}`);
        }
        
        const data = await res.json();
        setAnnouncements(data);
      } catch (err) {
        console.error("Error fetching announcements:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchAnnouncements();
  }, []);

  // Filter out expired announcements
  const currentAnnouncements = announcements.filter(ann => {
    const postTill = new Date(ann.post_till);
    const now = new Date();
    return postTill > now;
  });

  // Sort by most recent first
  const sortedAnnouncements = [...currentAnnouncements].sort((a, b) => 
    new Date(b.date_posted) - new Date(a.date_posted)
  );

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-sm text-zinc-500">Loading announcements...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="text-sm text-rose-600">Error: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-gray-900">Announcements</h1>
        <p className="text-sm text-zinc-500 mt-2">
          Important updates and messages from the admin team
        </p>
      </div>

      {sortedAnnouncements.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <div className="text-lg font-medium text-zinc-700 mb-2">
              No Current Announcements
            </div>
            <div className="text-sm text-zinc-500">
              There are no active announcements at the moment.
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedAnnouncements.map((announcement) => (
            <AnnouncementCard key={announcement.id} announcement={announcement} />
          ))}
        </div>
      )}
    </div>
  );
}

function AnnouncementCard({ announcement }) {
  const [isExpanded, setIsExpanded] = useState(false);
  
  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const postedDate = formatDate(announcement.date_posted);
  const expiresDate = formatDate(announcement.post_till);

  // Simple check if content might be long (more than 200 chars)
  const isLongContent = announcement.announcement.length > 200;
  const displayContent = isExpanded 
    ? announcement.announcement 
    : (isLongContent 
        ? announcement.announcement.slice(0, 200) + '...' 
        : announcement.announcement
      );

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-3">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">
              {announcement.title}
            </h3>
            <div className="flex items-center gap-4 text-xs text-zinc-500">
              <span>Posted: {postedDate}</span>
              <span>•</span>
              <span>Expires: {expiresDate}</span>
            </div>
          </div>
          <div className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full font-medium">
            Announcement
          </div>
        </div>

        {/* Content */}
        <div className="text-sm text-gray-700 leading-relaxed mb-4">
          {displayContent}
        </div>

        {/* Expand/Collapse Button */}
        {isLongContent && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            {isExpanded ? 'Show Less' : 'Read More'}
          </button>
        )}
      </div>
    </Card>
  );
}