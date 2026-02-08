import React, { useState, useEffect, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import { Task, TaskStatus, AppState, INITIAL_APP_STATE, Attachment, ActivityLog, Project, User, USERS } from './types';
import { Icons } from './components/Icons';
import { getStrategicAdvice, generateTaskSuggestions } from './services/geminiService';

// --- HELPERS ---
const generateId = () => Math.random().toString(36).substring(2, 10);

// Improved fileToBase64 with compression to fit localStorage
const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 800; // Limit width to save space
        const scaleSize = MAX_WIDTH / img.width;
        
        // Calculate new dimensions
        const width = (img.width > MAX_WIDTH) ? MAX_WIDTH : img.width;
        const height = (img.width > MAX_WIDTH) ? img.height * scaleSize : img.height;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Return compressed JPEG
        resolve(canvas.toDataURL('image/jpeg', 0.7)); 
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

const getTaskProgress = (task: Task): number => {
  if (task.subtasks.length === 0) {
    return task.status === TaskStatus.COMPLETED ? 100 : 0;
  }
  const totalProgress = task.subtasks.reduce((acc, sub) => acc + getTaskProgress(sub), 0);
  return Math.round(totalProgress / task.subtasks.length);
};

const getProjectProgress = (project: Project): number => {
    if (project.tasks.length === 0) return 0;
    const total = project.tasks.reduce((acc, t) => acc + getTaskProgress(t), 0);
    return Math.round(total / project.tasks.length);
};

// Recursive search
const searchTasks = (tasks: Task[], query: string): Task[] => {
  return tasks.reduce((acc: Task[], task) => {
    const match = task.title.toLowerCase().includes(query.toLowerCase()) || 
                  task.description?.toLowerCase().includes(query.toLowerCase());
    const childMatches = searchTasks(task.subtasks, query);
    if (match || childMatches.length > 0) {
      acc.push({ ...task, subtasks: childMatches, expanded: true });
    }
    return acc;
  }, []);
};

// State Updates
const findTaskAndUpdate = (tasks: Task[], targetId: string, updater: (t: Task) => Task): Task[] => {
  return tasks.map(task => {
    if (task.id === targetId) return updater(task);
    if (task.subtasks.length > 0) return { ...task, subtasks: findTaskAndUpdate(task.subtasks, targetId, updater) };
    return task;
  });
};

const findTaskAndAddSubtask = (tasks: Task[], parentId: string, newTask: Task): Task[] => {
  return tasks.map(task => {
    if (task.id === parentId) return { ...task, subtasks: [...task.subtasks, newTask], expanded: true };
    if (task.subtasks.length > 0) return { ...task, subtasks: findTaskAndAddSubtask(task.subtasks, parentId, newTask) };
    return task;
  });
};

const findTaskAndDelete = (tasks: Task[], targetId: string): Task[] => {
  return tasks.filter(t => t.id !== targetId).map(task => ({
    ...task,
    subtasks: findTaskAndDelete(task.subtasks, targetId)
  }));
};

// --- COLOR THEMES ---
const TASK_THEMES = [
  { name: 'Indigo', border: 'border-indigo-500/30', bg: 'bg-indigo-500/5', hover: 'hover:border-indigo-500/50', text: 'text-indigo-400' },
  { name: 'Emerald', border: 'border-emerald-500/30', bg: 'bg-emerald-500/5', hover: 'hover:border-emerald-500/50', text: 'text-emerald-400' },
  { name: 'Rose', border: 'border-rose-500/30', bg: 'bg-rose-500/5', hover: 'hover:border-rose-500/50', text: 'text-rose-400' },
  { name: 'Amber', border: 'border-amber-500/30', bg: 'bg-amber-500/5', hover: 'hover:border-amber-500/50', text: 'text-amber-400' },
  { name: 'Cyan', border: 'border-cyan-500/30', bg: 'bg-cyan-500/5', hover: 'hover:border-cyan-500/50', text: 'text-cyan-400' },
];

const PROJECT_THEMES = [
    "bg-gradient-to-br from-[#1e1b4b] to-[#312e81] border-indigo-500/40 shadow-indigo-900/20",
    "bg-gradient-to-br from-[#064e3b] to-[#065f46] border-emerald-500/40 shadow-emerald-900/20",
    "bg-gradient-to-br from-[#881337] to-[#9f1239] border-rose-500/40 shadow-rose-900/20",
    "bg-gradient-to-br from-[#451a03] to-[#78350f] border-amber-500/40 shadow-amber-900/20",
    "bg-gradient-to-br from-[#164e63] to-[#155e75] border-cyan-500/40 shadow-cyan-900/20",
];

// --- CONTEXT ---
interface AppContextType {
  state: AppState;
  currentUser: User;
  users: User[]; 
  activeProjectId: string | null;
  draggedTaskId: string | null;
  setDraggedTaskId: (id: string | null) => void;
  setActiveProjectId: (id: string | null) => void;
  addProject: (title: string, subtitle: string) => void;
  updateProject: (id: string, updates: Partial<Project>) => void; 
  deleteProject: (id: string) => void;
  updateCurrentUser: (updates: Partial<User>) => void; 
  logout: () => void;
  toggleTaskStatus: (taskId: string) => void;
  addTask: (parentId: string | null, title: string) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void; 
  deleteTask: (taskId: string) => void;
  moveTask: (draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => void;
  addActivity: (taskId: string, content: string, type: ActivityLog['type']) => void;
  addAttachment: (taskId: string, type: Attachment['type'], name: string, url: string) => void;
  toggleExpand: (taskId: string) => void;
  openTaskDetail: (task: Task) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  requestInput: (title: string, callback: (val: string) => void) => void;
  openAIModal: () => void;
  openStatsModal: () => void;
  openProfileModal: () => void;
}

const AppContext = createContext<AppContextType | null>(null);

// --- COMPONENTS ---

const Avatar: React.FC<{ user?: User, size?: string }> = ({ user, size = "w-8 h-8" }) => {
  if (!user) return <div className={`${size} rounded-full bg-gray-600`}></div>;
  
  if (user.avatarUrl) {
    return <img src={user.avatarUrl} alt={user.name} className={`${size} rounded-full object-cover border border-white/10 shadow-md`} />;
  }
  
  return (
    <div className={`${size} rounded-full ${user.avatarColor} flex items-center justify-center text-white font-bold text-xs shadow-md border border-white/10`}>
      {user.name.charAt(0)}
    </div>
  );
};

const IntroScreen: React.FC<{ onSelectUser: (u: User) => void; users: User[] }> = ({ onSelectUser, users }) => {
  return (
    <div className="fixed inset-0 z-50 bg-[#050505] flex flex-col items-center justify-center p-4">
      <div className="text-center mb-16">
         <h1 className="text-4xl md:text-6xl font-display font-medium text-white tracking-widest animate-cinematic bg-clip-text text-transparent bg-gradient-to-br from-white via-gray-200 to-gray-500">
           Proyectate
         </h1>
         <p className="text-gray-400 mt-3 font-sans font-light tracking-[0.3em] uppercase text-[10px] md:text-xs animate-fade-in" style={{ animationDelay: '1s' }}>
           Relajo con Orden
         </p>
      </div>

      <div className="flex gap-6 animate-slide-up" style={{ animationDelay: '1.2s' }}>
        {users.map(user => (
          <button
            key={user.id}
            onClick={() => onSelectUser(user)}
            className="group relative flex flex-col items-center gap-3 p-6 rounded-2xl bg-white/5 border border-white/10 hover:border-primary/50 hover:bg-white/10 transition-all duration-300 w-32"
          >
            <Avatar user={user} size="w-16 h-16" />
            <span className="text-gray-300 font-medium group-hover:text-white">{user.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

const InputModal: React.FC<{ title: string; onClose: () => void; onSubmit: (val: string) => void }> = ({ title, onClose, onSubmit }) => {
    const [value, setValue] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if(inputRef.current) inputRef.current.focus();
    }, []);

    const handleSubmit = (e?: React.FormEvent) => {
        e?.preventDefault();
        if(value.trim()) {
            onSubmit(value);
            onClose();
        }
    }

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#0c0c0e] border border-white/10 rounded-2xl w-full max-w-md p-6 shadow-2xl animate-slide-up" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-display font-normal text-white mb-4 tracking-wide">{title}</h3>
                <form onSubmit={handleSubmit}>
                    <input 
                        ref={inputRef}
                        type="text" 
                        value={value}
                        onChange={(e) => setValue(e.target.value)}
                        placeholder="Escribe aquí..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 mb-6"
                    />
                    <div className="flex justify-end gap-3">
                        <button type="button" onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white text-sm font-medium transition-colors">Cancelar</button>
                        <button type="submit" disabled={!value.trim()} className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed">Guardar</button>
                    </div>
                </form>
            </div>
        </div>
    )
}

const ProfileModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const ctx = useContext(AppContext);
    const [name, setName] = useState(ctx?.currentUser.name || '');
    const [uploading, setUploading] = useState(false);
    
    if (!ctx) return null;

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setUploading(true);
            try {
                const base64 = await fileToBase64(e.target.files[0]);
                ctx.updateCurrentUser({ avatarUrl: base64 });
            } catch (e) {
                alert("Error al procesar la imagen. Intenta con una más pequeña.");
            }
            setUploading(false);
        }
    };

    const handleSave = () => {
        if (name.trim()) ctx.updateCurrentUser({ name });
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#111115] border border-white/10 rounded-2xl w-full max-w-md p-8 shadow-2xl animate-slide-up flex flex-col items-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-xl font-display font-normal text-white mb-6 tracking-wide">Editar Perfil</h3>
                
                <div className="relative group cursor-pointer mb-6">
                    <Avatar user={ctx.currentUser} size="w-24 h-24" />
                    <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        {uploading ? <div className="animate-spin w-6 h-6 border-2 border-white/30 border-t-white rounded-full"></div> : <Icons.Camera className="text-white" size={24} />}
                        <input type="file" className="hidden" accept="image/*" onChange={handleFileChange} />
                    </label>
                </div>

                <input 
                    type="text" 
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-center placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 mb-6"
                />

                <div className="flex w-full gap-3">
                    <button onClick={onClose} className="flex-1 py-2 text-gray-400 hover:text-white text-sm font-medium transition-colors">Cancelar</button>
                    <button onClick={handleSave} className="flex-1 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-bold transition-colors">Guardar Cambios</button>
                </div>
            </div>
        </div>
    );
};

// ... AIModal and StatsModal (keep as is) ...
const AIModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const [query, setQuery] = useState('');
    const [response, setResponse] = useState('');
    const [loading, setLoading] = useState(false);
    const ctx = useContext(AppContext);
    
    const activeProject = ctx?.state.projects.find(p => p.id === ctx.activeProjectId);
    const contextStr = activeProject 
        ? `Proyecto Activo: ${activeProject.title} (${activeProject.subtitle}). Tareas actuales: ${activeProject.tasks.map(t => t.title).join(', ')}.` 
        : "Sin proyecto activo seleccionado en el dashboard.";

    const handleAsk = async () => {
        if(!query.trim()) return;
        setLoading(true);
        const res = await getStrategicAdvice(contextStr, query);
        setResponse(res);
        setLoading(false);
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#111115] border border-indigo-500/30 rounded-2xl w-full max-w-2xl p-6 shadow-2xl shadow-indigo-900/20 animate-slide-up flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-2xl font-display font-normal text-white flex items-center gap-3 tracking-wide">
                        <Icons.Bot className="text-indigo-400" />
                        Consultor Estratégico
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400"><Icons.Close /></button>
                </div>

                <div className="flex-1 overflow-y-auto mb-6 pr-2">
                    {response ? (
                         <div className="prose prose-invert prose-sm max-w-none bg-white/5 p-4 rounded-xl border border-white/5">
                            {response.split('\n').map((line, i) => <p key={i} className="mb-2 last:mb-0">{line}</p>)}
                         </div>
                    ) : (
                        <div className="text-center py-12 text-gray-500">
                            <Icons.Bot className="w-12 h-12 mx-auto mb-3 opacity-20" />
                            <p>Modos: Inversor Escéptico, Analista Técnico (MSP/Niza) o Calculadora PYME.</p>
                            <p className="text-sm mt-2">"¿En qué proyecto trabajamos hoy: TAOASIS o GUTEN?"</p>
                        </div>
                    )}
                </div>

                <div className="relative">
                    <input 
                        type="text" 
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
                        placeholder="Ej: ¿Cuál es el Landed Cost de este producto?"
                        className="w-full bg-black/30 border border-white/10 rounded-xl py-4 pl-4 pr-12 text-white focus:outline-none focus:border-indigo-500/50"
                        disabled={loading}
                    />
                    <button 
                        onClick={handleAsk}
                        disabled={loading || !query.trim()}
                        className="absolute right-2 top-2 p-2 bg-indigo-600 rounded-lg text-white disabled:opacity-50 hover:bg-indigo-500 transition-colors"
                    >
                        {loading ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Icons.ArrowRight size={20} />}
                    </button>
                </div>
            </div>
        </div>
    )
}

const StatsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const ctx = useContext(AppContext);
    if (!ctx) return null;

    const totalProjects = ctx.state.projects.length;
    let totalTasks = 0;
    let completedTasks = 0;

    ctx.state.projects.forEach(p => {
        const countTasks = (tasks: Task[]) => {
            tasks.forEach(t => {
                totalTasks++;
                if (t.status === TaskStatus.COMPLETED) completedTasks++;
                countTasks(t.subtasks);
            });
        };
        countTasks(p.tasks);
    });

    const completionRate = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;

    return (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
            <div className="bg-[#111115] border border-emerald-500/30 rounded-2xl w-full max-w-lg p-8 shadow-2xl shadow-emerald-900/20 animate-slide-up" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-8">
                    <h3 className="text-2xl font-display font-normal text-white flex items-center gap-3 tracking-wide">
                        <Icons.Chart className="text-emerald-400" />
                        Estadísticas Globales
                    </h3>
                    <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-full text-gray-400"><Icons.Close /></button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-4xl font-display font-bold text-white mb-2">{totalProjects}</span>
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Proyectos</span>
                    </div>
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center">
                        <span className="text-4xl font-display font-bold text-emerald-400 mb-2">{completionRate}%</span>
                        <span className="text-xs text-gray-400 uppercase tracking-widest">Progreso Total</span>
                    </div>
                    <div className="bg-white/5 p-6 rounded-2xl border border-white/5 flex flex-col items-center justify-center col-span-2">
                        <div className="flex justify-between w-full mb-2 text-sm text-gray-300">
                            <span>Tareas Completadas</span>
                            <span className="font-mono">{completedTasks}/{totalTasks}</span>
                        </div>
                        <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${completionRate}%` }}></div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

const ProgressRing: React.FC<{ progress: number; size?: number; stroke?: number; colorClass?: string }> = ({ progress, size = 32, stroke = 4, colorClass = 'text-primary' }) => {
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;
  
  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        <circle cx={size/2} cy={size/2} r={radius} stroke="currentColor" strokeWidth={stroke} fill="transparent" className="text-white/10" />
        <circle 
          cx={size/2} cy={size/2} r={radius} 
          stroke="currentColor" strokeWidth={stroke} fill="transparent" 
          strokeDasharray={circumference} strokeDashoffset={offset} 
          className={`transition-all duration-500 ease-out ${progress === 100 ? 'text-green-400' : colorClass}`}
          strokeLinecap="round"
        />
      </svg>
      {progress > 0 && progress < 100 && (
         <span className="absolute text-[10px] font-bold text-white">{progress}</span>
      )}
      {progress === 100 && <Icons.Check size={size/1.5} className="absolute text-green-400" />}
    </div>
  );
};

// ... TaskCard (keep as is) ...
const TaskCard: React.FC<{ task: Task; depth: number; themeIndex: number }> = ({ task, depth, themeIndex }) => {
  const ctx = useContext(AppContext);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | 'inside' | null>(null);

  if (!ctx) return null;

  const isDragging = ctx.draggedTaskId === task.id;
  const progress = getTaskProgress(task);
  const isLeaf = task.subtasks.length === 0;
  const hasAttachments = task.attachments.length > 0;
  const hasComments = task.activity.length > 1;
  const isOwner = task.createdBy === ctx.currentUser.id;
  const owner = ctx.users.find(u => u.id === task.createdBy); 
  const theme = TASK_THEMES[themeIndex % TASK_THEMES.length];
  
  const cardStyle = depth === 0 
    ? `${theme.bg} ${theme.border} hover:shadow-[0_0_15px_rgba(0,0,0,0.2)] ${theme.hover}`
    : `bg-white/[0.02] border-white/5 hover:bg-white/5 hover:border-white/10`;

  const getDropPositionFromEvent = (e: React.DragEvent): 'before' | 'after' | 'inside' => {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const x = e.clientX - rect.left;
      const isTop = y < rect.height / 2;
      if (isTop) return 'before';
      if (x > 40) return 'inside';
      return 'after';
  };

  const handleDragStart = (e: React.DragEvent) => {
      e.stopPropagation();
      ctx.setDraggedTaskId(task.id);
      e.dataTransfer.setData('taskId', task.id);
      e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = (e: React.DragEvent) => {
      e.stopPropagation();
      ctx.setDraggedTaskId(null);
      setDropPosition(null);
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault(); 
      e.stopPropagation();
      if (!ctx.draggedTaskId || ctx.draggedTaskId === task.id) return;
      e.dataTransfer.dropEffect = 'move';
      const pos = getDropPositionFromEvent(e);
      if (dropPosition !== pos) {
          setDropPosition(pos);
      }
  };

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const draggedId = ctx.draggedTaskId;
      const finalPos = getDropPositionFromEvent(e);
      if (draggedId && draggedId !== task.id) {
          ctx.moveTask(draggedId, task.id, finalPos);
      }
      ctx.setDraggedTaskId(null);
      setDropPosition(null);
  };

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isOwner) {
        alert(`Solo ${owner?.name} puede completar esta tarea.`);
        return;
    }
    if (isLeaf) ctx.toggleTaskStatus(task.id);
  };

  const handleAddSubtask = (e: React.MouseEvent) => {
    e.stopPropagation();
    ctx.requestInput(`Agregar subtarea a "${task.title}"`, (title) => {
        ctx.addTask(task.id, title);
    });
  }

  return (
    <div className={`relative group ${depth > 0 ? 'ml-6 pl-6 border-l border-white/5' : ''} pb-6`}> 
      {depth > 0 && <div className="absolute top-8 left-0 w-6 h-[1px] bg-white/5"></div>}

      <div 
        draggable
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => ctx.openTaskDetail(task)}
        className={`relative rounded-xl p-5 transition-all duration-300 cursor-pointer border backdrop-blur-sm ${cardStyle} ${task.status === TaskStatus.COMPLETED && isLeaf ? 'opacity-50 grayscale' : 'opacity-100'} ${isDragging ? 'opacity-30 scale-95' : ''}`}
      >
        {!isDragging && dropPosition === 'before' && <div className="absolute -top-2 left-0 right-0 h-1 bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.8)] z-50 rounded-full pointer-events-none"></div>}
        {!isDragging && dropPosition === 'after' && <div className="absolute -bottom-2 left-0 right-0 h-1 bg-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.8)] z-50 rounded-full pointer-events-none"></div>}
        {!isDragging && dropPosition === 'inside' && <div className="absolute inset-0 border-2 border-indigo-500 rounded-xl pointer-events-none bg-indigo-500/10 z-50 animate-pulse"></div>}

        <div className="flex items-start justify-between gap-4 pointer-events-none">
            <div className="flex items-start gap-4 flex-1">
                <div onClick={handleStatusClick} className={`pointer-events-auto cursor-pointer transition-transform mt-1 ${isOwner ? 'hover:scale-110' : 'cursor-not-allowed opacity-50'}`}>
                {isLeaf ? (
                    task.status === TaskStatus.COMPLETED ? 
                    <div className="w-8 h-8 rounded-full bg-green-500/20 border border-green-500 flex items-center justify-center text-green-500"><Icons.Check size={20} /></div> :
                    <div className={`w-8 h-8 rounded-full border border-white/30 ${isOwner ? 'hover:border-white' : ''} flex items-center justify-center`}>
                        {!isOwner && <Icons.Lock size={12} className="text-gray-500" />}
                    </div>
                ) : (
                    <ProgressRing progress={progress} size={32} stroke={4} colorClass={theme.text} />
                )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        <h3 className={`font-display font-medium text-xl leading-snug pb-1 truncate ${task.status === TaskStatus.COMPLETED ? 'line-through text-gray-500' : 'text-gray-100'}`}>
                        {task.title}
                        </h3>
                        {hasAttachments && <Icons.Link size={12} className={theme.text} />}
                        {hasComments && <div className={`w-1.5 h-1.5 rounded-full ${theme.bg.replace('/5','')} ${theme.text}`}></div>}
                    </div>
                    {task.description && <p className="text-sm text-gray-400 truncate mb-3">{task.description}</p>}
                    
                    <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 bg-white/5 px-2 py-1 rounded text-[10px] text-gray-400 border border-white/5">
                            <Avatar user={owner} size="w-4 h-4" />
                            {owner?.name}
                        </div>
                        <button onClick={handleAddSubtask} className="pointer-events-auto flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded-lg transition-colors duration-200 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-gray-200">
                            <Icons.Add size={12} /> Agregar
                        </button>
                    </div>
                </div>
            </div>
            {task.subtasks.length > 0 && (
                <button onClick={(e) => { e.stopPropagation(); ctx.toggleExpand(task.id); }} className="pointer-events-auto p-2 hover:bg-white/10 rounded-full text-gray-400 transition-colors">
                {task.expanded ? <Icons.Collapse size={20} /> : <Icons.Expand size={20} />}
                </button>
            )}
        </div>
      </div>
      {task.expanded && <div className="mt-3">{task.subtasks.map(sub => <TaskCard key={sub.id} task={sub} depth={depth + 1} themeIndex={themeIndex} />)}</div>}
    </div>
  );
};

const TaskDetailModal: React.FC<{ task: Task; onClose: () => void }> = ({ task, onClose }) => {
    const ctx = useContext(AppContext);
    const [newComment, setNewComment] = useState('');
    const [activeTab, setActiveTab] = useState<'info' | 'ai'>('info');
    const [isGeneratingAI, setIsGeneratingAI] = useState(false);
    const [linkUrl, setLinkUrl] = useState('');
    const [showLinkInput, setShowLinkInput] = useState(false);
    
    const [isRecording, setIsRecording] = useState(false);
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);

    const commentsRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (commentsRef.current) commentsRef.current.scrollTop = commentsRef.current.scrollHeight;
    }, [task.activity]);

    if (!ctx) return null;
    const project = ctx.state.projects.find(p => p.id === ctx.activeProjectId);

    const handleAddComment = (e: React.FormEvent) => {
        e.preventDefault();
        if (newComment.trim()) {
            ctx.addActivity(task.id, newComment, 'comment');
            setNewComment('');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            try {
                const base64 = await fileToBase64(file);
                ctx.addAttachment(task.id, 'document', file.name, base64);
            } catch (err) {
                alert("Error al subir archivo. Intenta con uno más pequeño.");
            }
        }
    };

    const handleAddLink = () => {
        if(linkUrl.trim()) {
            ctx.addAttachment(task.id, 'link', linkUrl, linkUrl);
            setLinkUrl('');
            setShowLinkInput(false);
        }
    }

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];
            
            mediaRecorder.current.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.current.push(e.data);
            };
            
            mediaRecorder.current.onstop = () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
                const reader = new FileReader();
                reader.readAsDataURL(audioBlob);
                reader.onloadend = () => {
                    const base64 = reader.result as string;
                    ctx.addAttachment(task.id, 'audio', `Nota de voz ${new Date().toLocaleTimeString()}`, base64);
                };
                stream.getTracks().forEach(track => track.stop());
            };
            
            mediaRecorder.current.start();
            setIsRecording(true);
        } catch (err) {
            alert("No se pudo acceder al micrófono.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorder.current && isRecording) {
            mediaRecorder.current.stop();
            setIsRecording(false);
        }
    };

    const handleGenerateSuggestions = async () => {
        setIsGeneratingAI(true);
        const suggestions = await generateTaskSuggestions(
            task.title, 
            task.description || '', 
            task.aiContext || '', 
            project?.title || ''
        );
        ctx.updateTask(task.id, { suggestedSteps: suggestions });
        setIsGeneratingAI(false);
    }

    return (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end animate-fade-in" onClick={onClose}>
            <div className="w-full max-w-2xl bg-[#0F0F12] h-full shadow-2xl border-l border-white/5 flex flex-col animate-slide-left" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="px-8 py-6 border-b border-white/5 flex items-start justify-between bg-[#0F0F12]/95 backdrop-blur z-10">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                             <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${task.status === TaskStatus.COMPLETED ? 'bg-green-500/10 border-green-500/30 text-green-400' : 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'}`}>
                                 {task.status === TaskStatus.COMPLETED ? 'Completada' : 'En Progreso'}
                             </span>
                        </div>
                        <h2 
                            className="text-2xl font-display font-medium text-white hover:text-indigo-400 cursor-pointer transition-colors leading-snug break-words"
                            onClick={() => ctx.requestInput("Renombrar Tarea", (val) => ctx.updateTask(task.id, { title: val }))}
                        >
                            {task.title}
                        </h2>
                    </div>
                    <div className="flex items-center gap-2">
                         <button onClick={() => ctx.deleteTask(task.id)} className="p-2 hover:bg-rose-500/10 rounded-lg text-gray-400 hover:text-rose-500 transition-colors"><Icons.Delete size={18} /></button>
                         <button onClick={onClose} className="p-2 hover:bg-white/10 rounded-lg text-gray-400 hover:text-white transition-colors"><Icons.Close size={20} /></button>
                    </div>
                </div>

                {/* Tabs */}
                <div className="flex items-center px-8 border-b border-white/5">
                    <button onClick={() => setActiveTab('info')} className={`py-4 mr-6 text-sm font-medium border-b-2 transition-colors ${activeTab === 'info' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>General</button>
                    <button onClick={() => setActiveTab('ai')} className={`py-4 text-sm font-medium border-b-2 transition-colors flex items-center gap-2 ${activeTab === 'ai' ? 'border-indigo-500 text-white' : 'border-transparent text-gray-500 hover:text-gray-300'}`}>
                        <Icons.Bot size={14}/> Inteligencia
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto custom-scrollbar p-8 space-y-8">
                    {activeTab === 'info' ? (
                        <>
                            <section>
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3 flex items-center gap-2"><Icons.File size={14} /> Descripción</h3>
                                <textarea 
                                    value={task.description || ''}
                                    onChange={(e) => ctx.updateTask(task.id, { description: e.target.value })}
                                    placeholder="Añadir descripción..."
                                    className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-gray-300 text-sm focus:outline-none focus:border-indigo-500/50 min-h-[120px] resize-none"
                                />
                            </section>

                            <section>
                                <div className="flex justify-between items-center mb-4">
                                    <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 flex items-center gap-2"><Icons.Link size={14} /> Adjuntos ({task.attachments.length})</h3>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={isRecording ? stopRecording : startRecording}
                                            className={`text-xs flex items-center gap-1 px-2 py-1 rounded transition-colors ${isRecording ? 'bg-red-500/20 text-red-400 animate-pulse' : 'text-indigo-400 hover:text-indigo-300'}`}
                                        >
                                            <Icons.Audio size={14} /> {isRecording ? 'Detener' : 'Nota de Voz'}
                                        </button>
                                        <button onClick={() => setShowLinkInput(!showLinkInput)} className="text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1"><Icons.Link size={14} /> Link</button>
                                        <label className="cursor-pointer text-xs text-indigo-400 hover:text-indigo-300 flex items-center gap-1">
                                            <Icons.Upload size={14} /> Archivo
                                            <input type="file" className="hidden" onChange={handleFileUpload} />
                                        </label>
                                    </div>
                                </div>
                                
                                {showLinkInput && (
                                    <div className="flex gap-2 mb-4 animate-fade-in">
                                        <input type="text" value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://..." className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white" />
                                        <button onClick={handleAddLink} className="bg-indigo-600 px-3 py-2 rounded-lg text-white text-xs font-bold">Agregar</button>
                                    </div>
                                )}

                                <div className="grid grid-cols-2 gap-3">
                                    {task.attachments.map(att => (
                                        <div key={att.id} className="group relative flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/5 hover:border-white/20 transition-all hover:bg-white/10">
                                            <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
                                                {att.type === 'link' ? <Icons.Link size={20} /> : att.type === 'audio' ? <Icons.Audio size={20} /> : <Icons.File size={20} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-sm text-gray-200 truncate">{att.name}</div>
                                                <div className="text-[10px] text-gray-500">{new Date(att.createdAt).toLocaleDateString()}</div>
                                            </div>
                                            {att.type === 'audio' && (
                                                <audio controls src={att.url} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                                            )}
                                            {att.type === 'link' && <a href={att.url} target="_blank" rel="noreferrer" className="absolute inset-0" />}
                                        </div>
                                    ))}
                                    {task.attachments.length === 0 && <div className="col-span-2 text-center py-4 border border-dashed border-white/10 rounded-xl text-gray-600 text-xs">Sin adjuntos</div>}
                                </div>
                            </section>

                            <section className="flex-1 flex flex-col">
                                <h3 className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-4 flex items-center gap-2"><Icons.Book size={14} /> Actividad</h3>
                                <div className="bg-black/20 rounded-xl border border-white/5 p-4 max-h-[300px] overflow-y-auto custom-scrollbar mb-4" ref={commentsRef}>
                                    {task.activity.map(log => {
                                        const user = ctx.users.find(u => u.id === log.createdBy);
                                        return (
                                            <div key={log.id} className="flex gap-3 mb-4 last:mb-0">
                                                <Avatar user={user} size="w-8 h-8" />
                                                <div className="flex-1">
                                                    <div className="flex items-baseline justify-between mb-1">
                                                        <span className="text-xs font-bold text-gray-300">{user?.name}</span>
                                                        <span className="text-[10px] text-gray-600">{new Date(log.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                                    </div>
                                                    <div className={`text-sm ${log.type === 'status_change' ? 'text-indigo-400 italic' : 'text-gray-400'}`}>{log.content}</div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                                <form onSubmit={handleAddComment} className="relative">
                                    <input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Comentar..." className="w-full bg-white/5 border border-white/10 rounded-xl pl-4 pr-12 py-3 text-sm text-white focus:outline-none focus:border-indigo-500/50" />
                                    <button type="submit" disabled={!newComment.trim()} className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg disabled:opacity-50"><Icons.ArrowRight size={16} /></button>
                                </form>
                            </section>
                        </>
                    ) : (
                        <div className="space-y-6 animate-fade-in">
                            <div className="bg-indigo-500/10 border border-indigo-500/30 rounded-xl p-6">
                                <h3 className="text-lg font-display text-white mb-2 flex items-center gap-2"><Icons.Bot className="text-indigo-400"/> Asistente de Tarea</h3>
                                <p className="text-sm text-gray-400 mb-4">La IA analizará el título, descripción y el contexto oculto que proveas para sugerir siguientes pasos.</p>
                                
                                <div className="mb-4">
                                    <label className="text-xs font-bold uppercase tracking-widest text-indigo-300 mb-2 block">Contexto Oculto (Solo para IA)</label>
                                    <textarea 
                                        value={task.aiContext || ''} 
                                        onChange={(e) => ctx.updateTask(task.id, { aiContext: e.target.value })}
                                        placeholder="Pega aquí contenido de emails, datos técnicos o restricciones que la IA deba saber..."
                                        className="w-full bg-black/40 border border-indigo-500/20 rounded-lg p-3 text-sm text-gray-300 focus:outline-none focus:border-indigo-500/50 min-h-[100px]"
                                    />
                                </div>
                                
                                <button 
                                    onClick={handleGenerateSuggestions} 
                                    disabled={isGeneratingAI}
                                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                                >
                                    {isGeneratingAI ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> : <Icons.Bot size={18} />}
                                    Generar Siguientes Pasos
                                </button>
                            </div>

                            {task.suggestedSteps && (
                                <div className="bg-white/5 border border-white/10 rounded-xl p-6 animate-slide-up">
                                    <h4 className="text-sm font-bold text-white mb-4 uppercase tracking-widest border-b border-white/10 pb-2">Sugerencias</h4>
                                    <div className="prose prose-invert prose-sm max-w-none">
                                        {task.suggestedSteps.split('\n').map((line, i) => <p key={i} className="mb-1">{line}</p>)}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const ProjectsList: React.FC = () => {
    const ctx = useContext(AppContext);
    if (!ctx) return null;

    return (
        <div className="container mx-auto px-6 py-12 max-w-6xl animate-fade-in">
             <div className="flex justify-between items-center mb-12">
                <div>
                    <h2 className="text-4xl font-display font-bold text-white mb-2">Mis Proyectos</h2>
                    <p className="text-gray-400">Selecciona un proyecto para comenzar a trabajar.</p>
                </div>
                <div className="flex items-center gap-4">
                     <div 
                        className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10 cursor-pointer hover:bg-white/10 transition-colors"
                        onClick={ctx.openProfileModal}
                     >
                        <Avatar user={ctx.currentUser} size="w-6 h-6" />
                        <span className="text-sm font-medium">{ctx.currentUser.name}</span>
                     </div>
                     <button onClick={ctx.logout} className="p-2 hover:bg-white/10 rounded-full text-gray-400 hover:text-white transition-colors"><Icons.Close size={20} /></button>
                </div>
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {ctx.state.projects.map((project, index) => {
                    const progress = getProjectProgress(project);
                    const theme = PROJECT_THEMES[index % PROJECT_THEMES.length]; // Use Theme
                    return (
                        <div 
                            key={project.id}
                            onClick={() => ctx.setActiveProjectId(project.id)}
                            className={`group relative rounded-3xl cursor-pointer transition-all duration-300 hover:-translate-y-2 overflow-hidden h-[300px] ${theme.split(' ')[0]}`} // Apply theme bg
                        >
                            <div className="absolute inset-0">
                                {project.imageUrl ? (
                                    <img src={project.imageUrl} alt={project.title} className="w-full h-full object-cover opacity-60 group-hover:opacity-40 transition-opacity" />
                                ) : (
                                    <div className="w-full h-full opacity-60"></div>
                                )}
                                <div className="absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent"></div>
                            </div>
                            
                            <div className="absolute inset-0 p-8 flex flex-col justify-end">
                                <div className="absolute top-6 right-6 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                                    <button onClick={(e) => { e.stopPropagation(); ctx.deleteProject(project.id); }} className="p-2 bg-black/40 hover:bg-red-500/80 rounded-full text-white/70 hover:text-white backdrop-blur-sm"><Icons.Delete size={16} /></button>
                                </div>

                                <h3 className="text-3xl font-display font-bold text-white mb-1 shadow-black drop-shadow-lg leading-tight pb-1">{project.title}</h3>
                                <p className="text-white/80 text-sm font-light tracking-wide mb-6">{project.subtitle}</p>

                                <div className="flex items-end justify-between">
                                    <div className="flex -space-x-3">
                                        <Avatar user={ctx.currentUser} size="w-10 h-10 border-2 border-black" />
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-2xl font-bold text-white">{progress}%</span>
                                    </div>
                                </div>
                                <div className="mt-4 w-full h-1.5 bg-white/20 rounded-full overflow-hidden">
                                    <div className="h-full bg-white shadow-[0_0_10px_rgba(255,255,255,0.5)] transition-all duration-1000" style={{ width: `${progress}%` }}></div>
                                </div>
                            </div>
                        </div>
                    );
                })}

                <button 
                    onClick={() => ctx.requestInput("Nuevo Proyecto", (title) => ctx.addProject(title, "Nuevo proyecto"))}
                    className="group flex flex-col items-center justify-center p-8 rounded-3xl border-2 border-dashed border-white/10 hover:border-indigo-500/50 hover:bg-indigo-500/5 transition-all duration-300 h-[300px]"
                >
                    <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center text-gray-400 group-hover:text-indigo-400 group-hover:scale-110 transition-all mb-4">
                        <Icons.Add size={32} />
                    </div>
                    <span className="text-gray-400 font-medium group-hover:text-indigo-300">Crear Proyecto</span>
                </button>
             </div>
        </div>
    );
}

const ProjectView: React.FC = () => {
    const ctx = useContext(AppContext);
    if (!ctx || !ctx.activeProjectId) return null;

    const project = ctx.state.projects.find(p => p.id === ctx.activeProjectId);
    if (!project) return null;

    const visibleTasks = ctx.searchQuery ? searchTasks(project.tasks, ctx.searchQuery) : project.tasks;
    const progress = getProjectProgress(project);

    const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            try {
                const base64 = await fileToBase64(e.target.files[0]);
                ctx.updateProject(project.id, { imageUrl: base64 });
            } catch(e) {
                alert("Error al subir imagen. Prueba con una más pequeña.");
            }
        }
    };

    return (
        <div className="h-screen flex flex-col bg-[#050505]">
            <header className="flex-none px-4 md:px-8 py-6 border-b border-white/5 bg-[#050505]/80 backdrop-blur-md z-20">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 max-w-7xl mx-auto">
                    <div className="flex items-center gap-4">
                        <button onClick={() => ctx.setActiveProjectId(null)} className="p-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white transition-all"><Icons.Close size={20} /></button>
                        <div className="flex items-center gap-3">
                            <label className="group cursor-pointer relative">
                                {project.imageUrl ? (
                                    <img src={project.imageUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/20" />
                                ) : (
                                    <div className="w-10 h-10 rounded-lg bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                                        <Icons.Camera size={18} className="text-indigo-400" />
                                    </div>
                                )}
                                <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Icons.Settings size={14} className="text-white" />
                                </div>
                                <input type="file" className="hidden" accept="image/*" onChange={handleImageUpload} />
                            </label>
                            
                            <div>
                                <h1 
                                    className="text-2xl md:text-3xl font-display font-bold text-white hover:text-indigo-400 transition-colors cursor-pointer leading-tight pb-1"
                                    onClick={() => ctx.requestInput("Nombre del Proyecto", (title) => ctx.updateProject(project.id, { title }))}
                                >
                                    {project.title}
                                </h1>
                                <div className="flex items-center gap-2">
                                     <span className="text-gray-500 text-xs md:text-sm">{project.subtitle}</span>
                                     <span className="text-[10px] font-sans font-normal text-gray-400 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">{progress}%</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex flex-col-reverse md:flex-row items-center gap-4 flex-1 justify-end w-full">
                        <div className="relative w-full max-w-md group">
                            <Icons.Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-indigo-400 transition-colors" size={18} />
                            <input type="text" placeholder="Buscar tareas..." value={ctx.searchQuery} onChange={(e) => ctx.setSearchQuery(e.target.value)} className="w-full bg-black/20 border border-white/10 rounded-xl py-2.5 pl-12 pr-4 text-sm text-white placeholder:text-gray-600 focus:outline-none focus:border-indigo-500/50 focus:bg-white/5 transition-all" />
                        </div>
                        <div className="h-8 w-[1px] bg-white/10 mx-2 hidden md:block"></div>
                        <div className="flex gap-2 w-full md:w-auto justify-end">
                             <button onClick={ctx.openStatsModal} className="p-2.5 rounded-xl hover:bg-emerald-500/10 text-gray-400 hover:text-emerald-400 transition-colors relative group">
                                 <Icons.Chart size={20} />
                             </button>
                             <button onClick={ctx.openAIModal} className="p-2.5 rounded-xl hover:bg-indigo-500/10 text-gray-400 hover:text-indigo-400 transition-colors relative group">
                                 <Icons.Bot size={20} />
                             </button>
                             <button onClick={() => ctx.requestInput("Nueva Tarea Principal", (title) => ctx.addTask(null, title))} className="flex-1 md:flex-none flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-xl font-medium text-sm transition-all shadow-lg shadow-indigo-900/20 whitespace-nowrap">
                                <Icons.Add size={18} /> <span className="inline">Tarea</span>
                             </button>
                        </div>
                    </div>
                </div>
            </header>
            <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
                <div className="max-w-4xl mx-auto space-y-4 pb-20">
                    {visibleTasks.length === 0 ? (
                        <div className="text-center py-20 opacity-30">
                            <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center mx-auto mb-6"><Icons.File size={40} /></div>
                            <p className="text-xl">No hay tareas pendientes</p>
                            <button onClick={() => ctx.addTask(null, "Primera tarea")} className="mt-4 text-indigo-400 hover:text-indigo-300">Crear la primera tarea</button>
                        </div>
                    ) : (
                        visibleTasks.map((task, i) => <TaskCard key={task.id} task={task} depth={0} themeIndex={i} />)
                    )}
                </div>
            </div>
        </div>
    );
}

// ... Main App Component Updates ...
const App: React.FC = () => {
  // ... State Initialization (Same as before) ...
  const [state, setState] = useState<AppState>(() => {
    try {
        const saved = localStorage.getItem('proyectate_app_state');
        if (saved) return JSON.parse(saved);
    } catch (e) { console.warn(e); }
    return INITIAL_APP_STATE;
  });

  // NEW: Persistent Users State
  const [users, setUsers] = useState<User[]>(() => {
    try {
      const saved = localStorage.getItem('proyectate_users');
      if (saved) return JSON.parse(saved);
    } catch (e) { console.warn(e); }
    return USERS;
  });
  
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [activeTask, setActiveTask] = useState<Task | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [modalConfig, setModalConfig] = useState<{title: string, callback: (val: string) => void} | null>(null);
  const [showAI, setShowAI] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [showProfile, setShowProfile] = useState(false);

  // Persistence Effects
  useEffect(() => { localStorage.setItem('proyectate_app_state', JSON.stringify(state)); }, [state]);
  
  const requestInput = useCallback((title: string, callback: (val: string) => void) => { setModalConfig({ title, callback }); }, []);

  const addProject = useCallback((title: string, subtitle: string) => {
      if(!currentUser) return;
      const newProject: Project = {
          id: generateId(), title, subtitle, createdAt: Date.now(), createdBy: currentUser.id, tasks: [],
          imageUrl: undefined
      };
      setState(prev => ({ ...prev, projects: [...prev.projects, newProject] }));
  }, [currentUser]);
  
  const deleteProject = useCallback((id: string) => { setState(prev => ({ ...prev, projects: prev.projects.filter(p => p.id !== id) })); }, []);
  const modifyActiveProject = useCallback((updater: (p: Project) => Project) => { if(!activeProjectId) return; setState(prev => ({ projects: prev.projects.map(p => p.id === activeProjectId ? updater(p) : p) })); }, [activeProjectId]);
  const updateProject = useCallback((id: string, updates: Partial<Project>) => { setState(prev => ({ projects: prev.projects.map(p => p.id === id ? { ...p, ...updates } : p) })); }, []);
  
  // Update Current User AND Persist to localStorage
  const updateCurrentUser = useCallback((updates: Partial<User>) => {
      if(!currentUser) return;
      
      const updatedUser = { ...currentUser, ...updates };
      setCurrentUser(updatedUser);
      
      setUsers(prevUsers => {
          const newUsers = prevUsers.map(u => u.id === currentUser.id ? updatedUser : u);
          localStorage.setItem('proyectate_users', JSON.stringify(newUsers)); // Explicit save
          return newUsers;
      });
  }, [currentUser]);

  const addTask = useCallback((parentId: string | null, title: string) => {
    if(!currentUser) return;
    const newTask: Task = {
      id: generateId(), title, status: TaskStatus.PENDING, attachments: [], tags: [], subtasks: [], expanded: true, createdBy: currentUser.id,
      activity: [{ id: generateId(), type: 'creation', content: 'Creado', timestamp: Date.now(), createdBy: currentUser.id }]
    };
    modifyActiveProject(p => {
        if(!parentId) return { ...p, tasks: [...p.tasks, newTask] };
        return { ...p, tasks: findTaskAndAddSubtask(p.tasks, parentId, newTask) };
    });
  }, [modifyActiveProject, currentUser]);

  const updateTask = useCallback((taskId: string, updates: Partial<Task>) => { modifyActiveProject(p => ({ ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, ...updates })) })); }, [modifyActiveProject]);
  
  const moveTask = useCallback((draggedId: string, targetId: string, position: 'before' | 'after' | 'inside') => {
      modifyActiveProject(p => {
          const newTasks = JSON.parse(JSON.stringify(p.tasks)) as Task[];
          let draggedItem: Task | null = null;
          const removeOp = (list: Task[]): boolean => {
              const idx = list.findIndex(t => t.id === draggedId);
              if (idx !== -1) { draggedItem = list[idx]; list.splice(idx, 1); return true; }
              return list.some(t => removeOp(t.subtasks));
          };
          if (!removeOp(newTasks) || !draggedItem) return p;
          const insertOp = (list: Task[]): boolean => {
              const idx = list.findIndex(t => t.id === targetId);
              if (idx !== -1) {
                  if (position === 'inside') { list[idx].subtasks.push(draggedItem!); list[idx].expanded = true; } 
                  else { const insertIdx = position === 'before' ? idx : idx + 1; list.splice(insertIdx, 0, draggedItem!); }
                  return true;
              }
              return list.some(t => insertOp(t.subtasks));
          };
          if (insertOp(newTasks)) return { ...p, tasks: newTasks };
          return p;
      });
  }, [modifyActiveProject]);

  const toggleTaskStatus = useCallback((taskId: string) => {
      modifyActiveProject(p => {
          const getStatus = (tasks: Task[]): TaskStatus | null => {
            for (const t of tasks) { if (t.id === taskId) return t.status; const sub = getStatus(t.subtasks); if (sub) return sub; } return null;
          };
          const currentStatus = getStatus(p.tasks);
          if (!currentStatus) return p;
          const newStatus = currentStatus === TaskStatus.COMPLETED ? TaskStatus.PENDING : TaskStatus.COMPLETED;
          const log: ActivityLog = { id: generateId(), type: 'status_change', content: newStatus === TaskStatus.COMPLETED ? 'Completó la tarea' : 'Reabrió la tarea', timestamp: Date.now(), createdBy: currentUser!.id };
          return { ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, status: newStatus, activity: [...t.activity, log] })) };
      });
  }, [modifyActiveProject, currentUser]);

  const deleteTask = useCallback((taskId: string) => { modifyActiveProject(p => ({ ...p, tasks: findTaskAndDelete(p.tasks, taskId) })); }, [modifyActiveProject]);
  const addActivity = useCallback((taskId: string, content: string, type: ActivityLog['type']) => { if(!currentUser) return; modifyActiveProject(p => ({ ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, activity: [...t.activity, { id: generateId(), type, content, timestamp: Date.now(), createdBy: currentUser.id }] })) })); }, [modifyActiveProject, currentUser]);
  
  const addAttachment = useCallback((taskId: string, type: Attachment['type'], name: string, url: string) => {
      if(!currentUser) return;
      const att: Attachment = { id: generateId(), name, type, url, createdAt: Date.now(), createdBy: currentUser.id };
      modifyActiveProject(p => ({ ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, attachments: [...t.attachments, att] })) }));
  }, [modifyActiveProject, currentUser]);

  const toggleExpand = useCallback((taskId: string) => { modifyActiveProject(p => ({ ...p, tasks: findTaskAndUpdate(p.tasks, taskId, t => ({ ...t, expanded: !t.expanded })) })); }, [modifyActiveProject]);

  const resolveActiveTask = (): Task | undefined => {
      if(!activeTask || !activeProjectId) return undefined;
      const p = state.projects.find(proj => proj.id === activeProjectId);
      if (!p) return undefined;
      const findDeep = (list: Task[]): Task | undefined => { for (const t of list) { if (t.id === activeTask.id) return t; const found = findDeep(t.subtasks); if (found) return found; } };
      return findDeep(p.tasks) || activeTask;
  };

  if (!currentUser) return <IntroScreen onSelectUser={setCurrentUser} users={users} />;

  return (
    <AppContext.Provider value={{ 
      state, currentUser, users, activeProjectId, setActiveProjectId, addProject, updateProject, deleteProject, logout: () => setCurrentUser(null),
      draggedTaskId, setDraggedTaskId, addTask, toggleTaskStatus, updateTask, deleteTask, addActivity, addAttachment, toggleExpand, moveTask,
      openTaskDetail: setActiveTask, searchQuery, setSearchQuery, requestInput, openAIModal: () => setShowAI(true), openStatsModal: () => setShowStats(true),
      updateCurrentUser, openProfileModal: () => setShowProfile(true)
    }}>
      <div className="min-h-screen bg-[#050505] text-gray-200 font-sans selection:bg-indigo-500/30">
        <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
          <div className="absolute top-[-10%] left-[-10%] w-[600px] h-[600px] bg-indigo-500/10 rounded-full blur-[120px] animate-blob"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] bg-purple-500/10 rounded-full blur-[120px] animate-blob" style={{ animationDelay: '5s' }}></div>
        </div>
        <main className="relative z-10">{activeProjectId ? <ProjectView /> : <ProjectsList />}</main>
        {modalConfig && <InputModal title={modalConfig.title} onClose={() => setModalConfig(null)} onSubmit={(val) => { modalConfig.callback(val); setModalConfig(null); }} />}
        {showAI && <AIModal onClose={() => setShowAI(false)} />}
        {showStats && <StatsModal onClose={() => setShowStats(false)} />}
        {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
        {activeTask && activeProjectId && <TaskDetailModal task={resolveActiveTask()!} onClose={() => setActiveTask(null)} />}
      </div>
    </AppContext.Provider>
  );
};

export default App;