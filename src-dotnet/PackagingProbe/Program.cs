// Reports runtime details used to verify the packaged .NET backend.
Console.WriteLine("{\"probe\":\"packaging\",\"runtime\":\"" + Environment.Version + "\",\"architecture\":\"" + System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture + "\"}");
