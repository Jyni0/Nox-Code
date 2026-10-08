/**
 * The icon set file-icon themes and custom icon rules pick from. Named
 * imports keep the bundle small (lucide ships thousands of icons).
 */
import {
  Anchor, AppWindow, Apple, Archive, Atom, AtSign, Award, Banana, Binary, Bird, Blocks, Book, BookOpen, Bookmark, Bot, Box, Boxes,
  Braces, Brackets, Brain, Brush, Bug, Cake, Calendar, Car, Carrot, Cat, Cherry, Circle, Citrus, Clock, Cloud, Code, CodeXml,
  Coffee, Cog, Compass, Component, Container, Cookie, Cpu, Crown, Database, Diamond, Diff, Dna, Dog, Droplet, Earth, Egg, Eye, Feather,
  File, FileArchive, FileAudio, FileBraces, FileCheck, FileCode, FileCog, FileDiff, FileImage, FileKey, FileLock, FileSpreadsheet,
  FileTerminal, FileText, FileType, FileVideo, Film, Fish, Flag, FlaskConical, Flame, Folder, FolderArchive, FolderClosed, FolderCode,
  FolderCog, FolderDot, FolderGit2, FolderHeart, FolderInput, FolderKanban, FolderKey, FolderLock, FolderOpen, FolderOutput, FolderRoot,
  FolderSearch, FolderTree, Gamepad2, Gem, Ghost, Gift, GitBranch, GitCommitHorizontal, GitMerge, Globe, Grape, Hammer, Hash, Heart,
  Hexagon, Image, Infinity as InfinityIcon, Key, Lamp, Layers, LayoutGrid, Leaf, Lightbulb, Link, List, ListChecks, ListTree, Lock,
  Magnet, Mail, Map, Microscope, Monitor, Moon, Mountain, Music, Orbit, Package, Palette, Paintbrush, Paperclip, PenTool, Pencil, Percent,
  Pilcrow, Pizza, Plug, Puzzle, Quote, Rabbit, Radar, Radiation, Regex, Rocket, Ruler, Satellite, Scale, Server, Settings, Settings2,
  Shapes, Shield, ShieldAlert, ShieldCheck, Ship, Sigma, Skull, Smartphone, Snowflake, Sparkles, Square, SquareFunction, SquareTerminal, Star, Sun,
  Table, Tag, Target, Telescope, Terminal, TestTube, Trash2, TreePine, Triangle, Trophy, Turtle, Type, Variable, Video, WandSparkles,
  Waves, Webhook, Wind, Workflow, Wrench, Zap,
  type LucideIcon,
} from "lucide-react";

export const ICON_LIBRARY: Record<string, LucideIcon> = {
  Anchor, AppWindow, Apple, Archive, Atom, AtSign, Award, Banana, Binary, Bird, Blocks, Book, BookOpen, Bookmark, Bot, Box, Boxes,
  Braces, Brackets, Brain, Brush, Bug, Cake, Calendar, Car, Carrot, Cat, Cherry, Circle, Citrus, Clock, Cloud, Code, CodeXml,
  Coffee, Cog, Compass, Component, Container, Cookie, Cpu, Crown, Database, Diamond, Diff, Dna, Dog, Droplet, Earth, Egg, Eye, Feather,
  File, FileArchive, FileAudio, FileBraces, FileCheck, FileCode, FileCog, FileDiff, FileImage, FileKey, FileLock, FileSpreadsheet,
  FileTerminal, FileText, FileType, FileVideo, Film, Fish, Flag, FlaskConical, Flame, Folder, FolderArchive, FolderClosed, FolderCode,
  FolderCog, FolderDot, FolderGit2, FolderHeart, FolderInput, FolderKanban, FolderKey, FolderLock, FolderOpen, FolderOutput, FolderRoot,
  FolderSearch, FolderTree, Gamepad2, Gem, Ghost, Gift, GitBranch, GitCommitHorizontal, GitMerge, Globe, Grape, Hammer, Hash, Heart,
  Hexagon, Image, Infinity: InfinityIcon, Key, Lamp, Layers, LayoutGrid, Leaf, Lightbulb, Link, List, ListChecks, ListTree, Lock,
  Magnet, Mail, Map, Microscope, Monitor, Moon, Mountain, Music, Orbit, Package, Palette, Paintbrush, Paperclip, PenTool, Pencil, Percent,
  Pilcrow, Pizza, Plug, Puzzle, Quote, Rabbit, Radar, Radiation, Regex, Rocket, Ruler, Satellite, Scale, Server, Settings, Settings2,
  Shapes, Shield, ShieldAlert, ShieldCheck, Ship, Sigma, Skull, Smartphone, Snowflake, Sparkles, Square, SquareFunction, SquareTerminal, Star, Sun,
  Table, Tag, Target, Telescope, Terminal, TestTube, Trash2, TreePine, Triangle, Trophy, Turtle, Type, Variable, Video, WandSparkles,
  Waves, Webhook, Wind, Workflow, Wrench, Zap,
};

export const ICON_NAMES = Object.keys(ICON_LIBRARY).sort();
