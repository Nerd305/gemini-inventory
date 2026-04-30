import { Card, CardContent } from '../ui/card';
import { formatDistanceToNow } from 'date-fns';
import React from 'react';

export interface CountingSessionData {
  id: string;
  userName: string;
  status: string;
  progress: {
    basketsCounted: number;
    totalVials: number;
  };
  startedAt: string;
  locationId: string;
}

export interface LiveSessionCardProps {
  session: CountingSessionData;
}

export const LiveSessionCard: React.FC<LiveSessionCardProps> = ({ session }) => {
  return (
    <Card className={`border-l-4 ${session.status === 'active' ? 'border-l-teal-500' : 'border-l-amber-500'}`}>
      <CardContent className="p-4 flex flex-col gap-2">
        <div className="flex justify-between items-start">
          <div>
            <h3 className="font-semibold text-gray-900">{session.userName}</h3>
            <p className="text-xs text-gray-500">
              {session.status === 'active' ? 'Counting actively' : 'Paused session'} • 
              Started {formatDistanceToNow(new Date(session.startedAt))} ago
            </p>
          </div>
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            session.status === 'active' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'
          }`}>
            {session.status.toUpperCase()}
          </span>
        </div>
        
        <div className="flex justify-between items-end mt-2 pt-2 border-t border-gray-100">
          <div>
            <p className="text-sm font-medium text-gray-700">Baskets Done</p>
            <p className="text-lg font-bold text-gray-900">{session.progress?.basketsCounted || 0}</p>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-gray-700">Total Vials</p>
            <p className="text-lg font-bold text-teal-600">{session.progress?.totalVials || 0}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
