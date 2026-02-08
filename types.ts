export enum TaskStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
}

export interface User {
  id: string;
  name: string;
  avatarColor: string;
}

export const USERS: User[] = [
  { id: 'u-leticia', name: 'Leticia', avatarColor: 'bg-rose-500' },
  { id: 'u-daniel', name: 'Daniel', avatarColor: 'bg-blue-500' },
];

export interface Attachment {
  id: string;
  name: string;
  type: 'image' | 'document' | 'audio' | 'video';
  url: string;
  createdAt: number;
  createdBy: string; // User ID
}

export interface ActivityLog {
  id: string;
  content: string;
  type: 'comment' | 'status_change' | 'creation' | 'attachment';
  timestamp: number;
  createdBy: string; // User ID
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  subtasks: Task[]; // Recursive
  attachments: Attachment[];
  activity: ActivityLog[];
  tags: string[]; 
  expanded?: boolean;
  createdBy: string; // User ID - Only owner can modify/delete
}

export interface Project {
  id: string;
  title: string;
  subtitle: string; 
  createdAt: number;
  createdBy: string; // User ID
  tasks: Task[];
  themeColor?: string;
}

export interface AppState {
  projects: Project[];
}

export const INITIAL_APP_STATE: AppState = {
  projects: [
    {
      id: 'p-1',
      title: "Taoasis",
      subtitle: "Proyecto de Inversión",
      createdAt: Date.now(),
      createdBy: 'u-leticia',
      tasks: [] // Clean slate
    }
  ]
};