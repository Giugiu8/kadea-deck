using System;
using System.Runtime.InteropServices;
internal static class CardeaOpen {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  private static extern IntPtr ShellExecute(IntPtr hwnd,string verb,string file,string args,string directory,int show);
  [STAThread] private static int Main(string[] args) {
    if(args.Length!=1)return 2;
    string u=args[0];
    bool allowed=u=="https://claude.ai/settings/usage"||u=="claude://code/needs-input?source=desktop_action"||u=="claude://code/new?source=desktop_action"||System.Text.RegularExpressions.Regex.IsMatch(u,@"^claude://claude\.ai/epitaxy/[a-zA-Z0-9_-]{1,180}$");
    allowed=allowed||System.Text.RegularExpressions.Regex.IsMatch(u,@"^codex://threads/(new|[a-fA-F0-9-]{36})$");
    if(!allowed)return 2;
    return ShellExecute(IntPtr.Zero,"open",u,null,null,1).ToInt64()>32?0:1;
  }
}
